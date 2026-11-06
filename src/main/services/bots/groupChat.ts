import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { retryableGroupFailures } from '../../../shared/bots/groupRetry';
import { parseMentions } from '../../../shared/bots/mentions';
import {
  buildSummaryNote,
  type HumanEntry,
  isSkipReply,
  mergePending,
  needsSmartRoute,
  onHumanMessage,
  onReply,
  type RouterState,
  startRound,
} from '../../../shared/bots/router';
import {
  buildSmartRouteInput,
  SMART_ROUTE_BUILD_NOTE,
  type SmartRouteDecision,
  type SmartRouteInput,
  type SmartRouteIntent,
} from '../../../shared/bots/smartRoute';
import { buildGroupDelta, buildGroupStateBlock } from '../../../shared/bots/transcript';
import type {
  BotChat,
  BotId,
  DelegationState,
  GroupEntry,
  GroupEntryInput,
  GroupTaskStatus,
  HumanEntryRefs,
} from '../../../shared/types/bot';
import type {
  BotActionResult,
  BotChatStateResult,
  BotEvent,
  BotSendResult,
} from '../../../shared/types/botIpc';
import { BOT_BUDGET_ERROR, BOT_TURN_LIMIT_ERROR } from '../../../shared/usage/botUsage';
import type {
  BotDeliverOptions,
  BotDeliverResult,
  BotSessionHost,
  BotTurnFinished,
} from './botSessionHost';
import type { BotStore } from './botStore';
import type { BotChatStore } from './chatStore';
import { readJson, writeJsonAtomic } from './files';
import { briefErrorReason } from './modelProbe';

interface Round {
  retrying?: boolean;
  /** 仅人类触发且至今全员 [skip] 的轮次保留；群主兜底最多一次 */
  allSkipped?: { botIds: BotId[]; forwarded?: boolean };
  state: RouterState;
  pending: HumanEntry[];
  options?: BotDeliverOptions;
  generation: number;
  deliveryId?: string;
  /** 人类追加消息的独立投递，不属于 current 的接力代际 */
  parallel: Map<
    string,
    {
      botId: BotId;
      conversationId: string;
      routedBy?: Extract<GroupEntry, { kind: 'bot' }>['routedBy'];
      /** 触发这条投递的人类消息，智能选人时作为该成员正在做的事 */
      task?: string;
    }
  >;
  stopping?: BotId[];
  /** 进行中的智能选人；abort 同时充当本次结果的身份 */
  routing?: { entry: HumanEntry; abort: AbortController; parallelOptions?: BotDeliverOptions };
  /** 本轮由智能选人选出、尚未发言的成员；其发言标 routedBy */
  smartPicked?: string[];
  /** 本批（一条人类消息 / 例行任务引发的整串接力）已结束的发言，批次结束时合并通知 */
  batch?: { botIds: string[]; failed: string[]; last?: { botId: string; text: string } };
  /** 智能选人判定的意图，写进 routedBy */
  smartIntent?: SmartRouteIntent;
  /** build 被选中的成员：其下一次投递附「先动手」指令 */
  buildNote?: BotId;
  /** 派单成员都回复后排队的群主汇总：投递时附 note，其发言标 routedBy: summary */
  summary?: { botId: BotId; note?: string };
}
interface AutonomousReply {
  botId: string;
  text: string;
  title: string | undefined;
  options: BotDeliverOptions;
  resolve: (result: BotSendResult) => void;
}
/** 智能选人：返回意图与有序成员 id 名单（1–3 位，build 只 1 位）；空名单交给群主。超时由 GroupChatService 统一兜底 */
export interface GroupResponderSelector {
  timeoutMs(): number;
  select(input: SmartRouteInput, signal: AbortSignal): Promise<SmartRouteDecision>;
}
export interface GroupBatchSettled {
  chatId: string;
  /** 有正文发言的成员（去重，按首次发言顺序）；[skip] 不算 */
  botIds: string[];
  failed: string[];
  lastBotId?: string;
  lastText?: string;
}
interface GroupChatDeps {
  bots: BotStore;
  chats: BotChatStore;
  host: Pick<BotSessionHost, 'deliver' | 'onTurnFinished' | 'stopTurn' | 'onDeliverySent'> &
    Partial<Pick<BotSessionHost, 'retryConversation'>>;
  emit: (event: BotEvent) => void;
  retryImages?: (chatId: string, mediaIds: string[]) => NonNullable<BotDeliverOptions['images']>;
  responder?: GroupResponderSelector;
  /** 明确的已指派任务补充先直通原执行；undefined 表示仍走普通群路由。 */
  routeTask?: (chatId: string, entry: HumanEntry) => Promise<BotSendResult | undefined>;
  /** 接力整批结束（无人在回复、无排队、无待路由消息）；用户停止的批次不报 */
  onBatchSettled?: (batch: GroupBatchSettled) => void;
  /** 输入框引用（@聊天 / $技能）：按被投递成员展开，附在增量之后 */
  refsAppendix?: (chat: BotChat, botId: BotId, entries: readonly GroupEntry[]) => Promise<string>;
  /** 某会话某一轮（BotTurnFinished.turnKey）新建委派的目标成员；正文 @ 他们不再接力 */
  delegatedTargets?: (conversationId: string, turnKey: string) => readonly string[];
  /** 压缩后补群状态用：进行中的委派与看板未完成任务 */
  groupState?: (chatId: string) => {
    delegations: readonly { from: BotId; to: BotId; state: DelegationState; task: string }[];
    tasks: readonly {
      seq: number;
      title: string;
      status: GroupTaskStatus;
      assigneeBotId?: BotId;
    }[];
  };
}
const SMART_ROUTE_HISTORY_SCAN = 40;
const empty = (): RouterState => ({
  rootEntrySeq: 0,
  current: null,
  queue: [],
  hops: 0,
  turnsByBot: {},
  noticed: [],
});
/** 本轮首个投递之后的接力：deliveryId 与 onlyIfIdle 只属于触发这一轮的那条投递 */
const relayOptions = (options: BotDeliverOptions | undefined): BotDeliverOptions | undefined => {
  if (!options) return options;
  const { deliveryId: _deliveryId, onlyIfIdle: _onlyIfIdle, ...rest } = options;
  return { ...rest, source: 'bot' };
};
const budgetNotice = (name: string) => `${name} 今日预算已用完`;
const isDecision = (value: unknown): value is SmartRouteDecision =>
  Boolean(value) &&
  typeof value === 'object' &&
  Array.isArray((value as SmartRouteDecision).ids) &&
  (value as SmartRouteDecision).ids.every((id) => typeof id === 'string');

/** 每群串行归并；router.json 只用于崩溃恢复，不重放未完成的工作。 */
export class GroupChatService {
  private rounds = new Map<string, Round>();
  private locks = new Map<string, Promise<unknown>>();
  private autonomous = new Map<string, AutonomousReply[]>();
  private readonly cursors = new Map<
    string,
    { chatId: string; botId: string; cursor: number; steered?: true }
  >();
  /** 刚压缩过、下次投递需补 <group-state> 的成员会话；只在内存，重启丢失可接受 */
  private readonly compacted = new Map<string, { chatId: string; botId: string }>();
  private readonly unsubscribe: () => void;
  private readonly unsubscribeSent: () => void;
  private disposed = false;

  constructor(private readonly deps: GroupChatDeps) {
    for (const chat of deps.chats.list()) {
      if (chat.kind !== 'group') continue;
      const saved = readJson(this.file(chat.id));
      const interrupted = new Set<string>();
      if (
        saved &&
        typeof saved === 'object' &&
        'state' in saved &&
        saved.state &&
        typeof saved.state === 'object' &&
        'current' in saved.state &&
        typeof saved.state.current === 'string'
      ) {
        interrupted.add(saved.state.current);
      }
      if (
        saved &&
        typeof saved === 'object' &&
        'parallel' in saved &&
        Array.isArray(saved.parallel)
      ) {
        for (const botId of saved.parallel)
          if (typeof botId === 'string' && chat.members.includes(botId)) interrupted.add(botId);
      }
      for (const botId of interrupted) {
        const conversationId = chat.sessions[botId]?.conversationId;
        this.system(
          chat.id,
          '回复被中断',
          conversationId ? { botId, conversationId, mode: 'resume' } : undefined
        );
      }
      this.persist(chat.id);
    }
    this.unsubscribeSent = deps.host.onDeliverySent((event) => {
      const pending = this.cursors.get(event.deliveryId);
      if (!pending) return;
      this.cursors.delete(event.deliveryId);
      if (event.steered) {
        pending.steered = true;
        if (this.round(pending.chatId).parallel.delete(event.deliveryId))
          this.persist(pending.chatId);
      }
      deps.chats.update(pending.chatId, (chat) => {
        const session = chat.sessions[pending.botId];
        if (session?.conversationId === event.conversationId)
          session.cursor = Math.max(session.cursor, pending.cursor);
        return chat;
      });
      if (event.steered) this.settleBatch(pending.chatId);
    });
    this.unsubscribe = deps.host.onTurnFinished((event) => {
      if (event.deliveryId) this.cursors.delete(event.deliveryId);
      if (
        this.disposed ||
        !event.chatId ||
        event.delegationId ||
        !this.rounds.has(event.chatId) ||
        deps.chats.get(event.chatId)?.kind !== 'group'
      )
        return;
      const id = event.chatId;
      const generation = this.round(id).generation;
      void this.lock(id, () => this.finished(event, generation)).catch((error) =>
        console.warn('[bots] group reply failed', error)
      );
    });
  }

  settled(chatId: string): Promise<unknown> {
    return this.locks.get(chatId) ?? Promise.resolve();
  }

  retry(chatId: string, entryId: string): Promise<BotActionResult> {
    return this.lock(chatId, async () => {
      const chat = this.deps.chats.get(chatId);
      if (this.disposed || chat?.kind !== 'group' || chat.archivedAt !== undefined)
        return { ok: false, error: 'group-unavailable' };
      const round = this.round(chatId);
      if (
        round.state.current ||
        round.parallel.size ||
        round.routing ||
        round.stopping ||
        round.pending.length
      )
        return { ok: false, error: 'session-busy' };
      const entry = this.deps.chats.findEntry(chatId, entryId);
      const entries = this.deps.chats.readAfter(chatId, chat.epochSeq ?? 0);
      if (
        entry?.kind !== 'system' ||
        !entry.failure ||
        !retryableGroupFailures(entries).has(entryId)
      )
        return { ok: false, error: 'retry-unavailable' };
      const { botId, conversationId, mode } = entry.failure;
      const bot = this.deps.bots.get(botId);
      if (
        !chat.members.includes(botId) ||
        !bot ||
        bot.archivedAt !== undefined ||
        (mode === 'resume' && chat.sessions[botId]?.conversationId !== conversationId)
      )
        return { ok: false, error: 'retry-unavailable' };
      round.state = { ...empty(), current: botId, turnsByBot: { [botId]: 1 } };
      round.options = undefined;
      round.retrying = true;
      delete round.deliveryId;
      round.generation++;
      this.persist(chatId);
      try {
        const human = entries.findLast((item) => item.kind === 'human');
        const mediaIds = human?.kind === 'human' ? human.images : undefined;
        if (mode === 'deliver' && mediaIds?.length && !this.deps.retryImages)
          throw new Error('retry images unavailable');
        const images =
          mode === 'deliver' && mediaIds?.length
            ? this.deps.retryImages?.(chatId, mediaIds)
            : undefined;
        const result =
          mode === 'resume' && conversationId
            ? ((await this.deps.host.retryConversation?.(conversationId)) ?? {
                ok: false,
                error: 'retry-unavailable',
              })
            : await this.deliver(chat, botId, { source: 'human', ...(images ? { images } : {}) });
        if (!result.ok) {
          round.state = empty();
          delete round.retrying;
          return result;
        }
        this.append(chatId, {
          kind: 'system',
          text: `正在重试 ${bot.name} 的回复`,
          retryOf: entryId,
          id: randomUUID(),
          at: Date.now(),
        });
        return { ok: true };
      } catch {
        round.state = empty();
        delete round.retrying;
        return { ok: false, error: 'retry-unavailable' };
      } finally {
        this.persist(chatId);
      }
    });
  }

  state(chatId: string): BotChatStateResult {
    if (this.deps.chats.get(chatId)?.kind !== 'group')
      return { ok: false, error: 'group-not-found' };
    const { state, pending, routing } = this.round(chatId);
    return {
      ok: true,
      current: state.current,
      queue: [...state.queue],
      hops: state.hops,
      turnsByBot: { ...state.turnsByBot },
      pendingHuman: pending.length > 0,
      routing: Boolean(routing),
    };
  }

  send(
    chatId: string,
    text: string,
    options: BotDeliverOptions = {},
    refs?: HumanEntryRefs,
    images?: string[]
  ): Promise<BotSendResult> {
    return this.lock(chatId, async () => {
      if (this.disposed) return { ok: false, error: 'disabled' };
      const chat = this.deps.chats.get(chatId);
      if (chat?.kind !== 'group' || chat.archivedAt !== undefined)
        return { ok: false, error: 'group-unavailable' };
      if (this.round(chatId).stopping) return { ok: false, error: 'chat-stopping' };
      // 手机离线队列按原 deliveryId 重放：同一条人类消息只落一次时间线
      const entryId = options.deliveryId ? `human:${options.deliveryId}` : randomUUID();
      if (options.deliveryId && this.deps.chats.findEntry(chatId, entryId))
        return { ok: true, duplicate: true };
      const members = this.members(chat);
      const entry = this.append(chatId, {
        kind: 'human',
        text,
        mentions: parseMentions(text, members).ids,
        ...(refs ? { refs } : {}),
        ...(images?.length ? { images } : {}),
        id: entryId,
        at: Date.now(),
      });
      if (entry?.kind !== 'human') return { ok: false, error: 'timeline-write-failed' };
      if (options.source === 'human') {
        const routed = await this.deps.routeTask?.(chatId, entry);
        if (routed !== undefined) return routed;
      }
      const round = this.round(chatId);
      if (round.routing) {
        // 选人期间又来人类消息：放弃本次结果，对合并后的消息重新判定
        const merged = mergePending([round.routing.entry, entry]) ?? entry;
        const parallel = round.routing.parallelOptions !== undefined;
        this.cancelRouting(round);
        if (parallel) await this.routeParallel(chat, merged, options);
        else {
          round.options = options;
          await this.begin(chat, merged);
        }
        this.persist(chatId);
        return { ok: true };
      }
      const decision = onHumanMessage(round.state, chat, members, entry);
      if (decision.action === 'steer') {
        await this.deliverParallel(chat, [round.state.current!], options, entry);
      } else if (decision.action === 'parallel') {
        await this.deliverParallel(chat, decision.targets, options, entry);
      } else if (
        decision.action === 'route-parallel' ||
        (decision.action === 'start' && round.parallel.size > 0)
      ) {
        await this.routeParallel(chat, entry, options);
      } else if (decision.action === 'restart-after-current') {
        round.pending.push(entry);
        round.options = options;
      } else {
        round.options = options;
        await this.begin(chat, entry);
      }
      this.persist(chatId);
      return { ok: true };
    });
  }

  runAs(
    chatId: string,
    botId: string,
    text: string,
    title: string | undefined,
    options: BotDeliverOptions = {}
  ): Promise<BotSendResult> {
    return new Promise((resolve) => {
      void this.lock(chatId, async () => {
        if (this.disposed) {
          resolve({ ok: false, error: 'disabled' });
          return;
        }
        const chat = this.deps.chats.get(chatId);
        if (
          chat?.kind !== 'group' ||
          chat.archivedAt !== undefined ||
          !chat.members.includes(botId)
        ) {
          resolve({ ok: false, error: 'group-unavailable' });
          return;
        }
        const jobs = this.autonomous.get(chatId) ?? [];
        jobs.push({ botId, text, title, options, resolve });
        this.autonomous.set(chatId, jobs);
        if (!this.round(chatId).state.current) await this.dispatch(chatId);
      }).catch((error) => resolve({ ok: false, error: String(error) }));
    });
  }

  stop(chatId: string): Promise<BotActionResult> {
    return this.lock(chatId, async () => {
      if (this.deps.chats.get(chatId)?.kind !== 'group')
        return { ok: false, error: 'group-not-found' };
      const round = this.round(chatId);
      const targets = [
        ...new Set([
          ...(round.stopping ?? []),
          ...(round.state.current ? [round.state.current] : []),
          ...Array.from(round.parallel.values(), (delivery) => delivery.botId),
        ]),
      ];
      round.generation++;
      round.state = empty();
      round.parallel.clear();
      round.pending = [];
      delete round.batch;
      delete round.retrying;
      this.cancelRouting(round);
      this.clearSmart(round);
      for (const job of this.autonomous.get(chatId) ?? [])
        job.resolve({ ok: false, error: 'chat-stopped' });
      this.autonomous.delete(chatId);
      this.persist(chatId);
      if (targets.length) {
        round.stopping = targets;
        try {
          while (targets.length) {
            await this.deps.host.stopTurn(chatId, targets[0]);
            targets.shift();
          }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : 'stop-failed' };
        }
        delete round.stopping;
      }
      return { ok: true };
    });
  }

  private async finished(event: BotTurnFinished, generation: number): Promise<void> {
    if (this.disposed) return;
    const chat = event.chatId ? this.deps.chats.get(event.chatId) : undefined;
    if (chat?.kind !== 'group') return;
    const round = this.round(chat.id);
    const parallel = event.deliveryId ? round.parallel.get(event.deliveryId) : undefined;
    if (
      parallel &&
      (parallel.botId !== event.botId || parallel.conversationId !== event.conversationId)
    )
      return;
    if (parallel && event.deliveryId) round.parallel.delete(event.deliveryId);
    if (
      (!parallel &&
        (generation !== round.generation ||
          round.state.current !== event.botId ||
          (event.deliveryId && round.deliveryId && event.deliveryId !== round.deliveryId))) ||
      chat.sessions[event.botId]?.conversationId !== event.conversationId
    ) {
      if (parallel) {
        this.persist(chat.id);
        this.settleBatch(chat.id);
      }
      return;
    }
    let seq: number | undefined;
    const summarized =
      !parallel && round.summary?.botId === event.botId && round.summary.note === undefined;
    if (summarized) delete round.summary;
    if (!event.ok) {
      const name = this.deps.bots.get(event.botId)?.name ?? '已删除成员';
      this.system(
        chat.id,
        event.error === BOT_BUDGET_ERROR
          ? budgetNotice(name)
          : event.error === BOT_TURN_LIMIT_ERROR
            ? `${name} 本回合用量${event.estimated ? '（按估算）' : ''}超过单回合上限，已停止`
            : `${name} 回复失败：${event.error ?? '未知错误'}`,
        { botId: event.botId, conversationId: event.conversationId, mode: 'resume' }
      );
    } else if (!isSkipReply(event.text) && event.turnId) {
      const smart = !parallel && (round.smartPicked?.includes(event.botId) ?? false);
      seq = this.append(chat.id, {
        kind: 'bot',
        botId: event.botId,
        text: event.text,
        conversationId: event.conversationId,
        turnId: event.turnId,
        ...(event.model ? { model: event.model } : {}),
        ...(summarized
          ? { routedBy: 'summary' as const }
          : parallel?.routedBy
            ? { routedBy: parallel.routedBy }
            : smart
              ? {
                  routedBy: round.smartIntent ? (`smart:${round.smartIntent}` as const) : 'smart',
                }
              : {}),
        id: randomUUID(),
        at: Date.now(),
      })?.seq;
    }
    this.recordBatch(round, event);
    if (parallel && event.deliveryId) {
      this.persist(chat.id);
      this.settleBatch(chat.id);
      return;
    }
    round.smartPicked = round.smartPicked?.filter((botId) => botId !== event.botId);
    const retrying = round.retrying;
    delete round.retrying;
    if (retrying) round.state = empty();
    else
      this.advance(
        chat,
        event.ok ? event.text : '',
        event.turnKey
          ? this.deps.delegatedTargets?.(event.conversationId, event.turnKey)
          : undefined,
        seq
      );
    const pending = mergePending(round.pending);
    if (pending) {
      round.pending = [];
      await this.begin(chat, pending);
    } else await this.dispatch(chat.id);
    this.persist(chat.id);
    this.settleBatch(chat.id);
  }

  private recordBatch(round: Round, event: BotTurnFinished): void {
    const batch = round.batch ?? { botIds: [], failed: [] };
    round.batch = batch;
    if (!event.ok) {
      if (!batch.failed.includes(event.botId)) batch.failed.push(event.botId);
    } else if (!isSkipReply(event.text) && event.text.trim()) {
      if (!batch.botIds.includes(event.botId)) batch.botIds.push(event.botId);
      batch.last = { botId: event.botId, text: event.text };
    }
  }

  /** 无人回复、无排队、无待路由的人类消息、无例行任务：本批结束 */
  private settleBatch(chatId: string): void {
    const round = this.round(chatId);
    const batch = round.batch;
    if (
      !batch ||
      round.state.current ||
      round.parallel.size > 0 ||
      round.routing ||
      round.pending.length > 0 ||
      this.autonomous.get(chatId)?.length
    )
      return;
    delete round.batch;
    if (batch.botIds.length === 0 && batch.failed.length === 0) return;
    try {
      this.deps.onBatchSettled?.({
        chatId,
        botIds: batch.botIds,
        failed: batch.failed,
        ...(batch.last ? { lastBotId: batch.last.botId, lastText: batch.last.text } : {}),
      });
    } catch (error) {
      console.warn('[bots] batch listener failed', error);
    }
  }

  /** 新一轮：需要智能选人时异步分类（不占锁），否则按 @ / 群主直接开始 */
  private async begin(chat: BotChat, entry: HumanEntry): Promise<void> {
    const round = this.round(chat.id);
    delete round.retrying;
    const members = this.members(chat);
    this.clearSmart(round);
    round.allSkipped = { botIds: [] };
    const responder = this.deps.responder;
    if (responder && needsSmartRoute(chat, members, entry)) {
      round.state = empty();
      this.selectResponders(chat, entry, responder);
      return;
    }
    round.state = startRound(chat, members, entry);
    if (!round.state.current) this.system(chat.id, '请先指定群主');
    await this.dispatch(chat.id);
  }

  private selectResponders(
    chat: BotChat,
    entry: HumanEntry,
    responder: GroupResponderSelector,
    parallelOptions?: BotDeliverOptions
  ): void {
    const abort = new AbortController();
    const round = this.round(chat.id);
    round.routing = { entry, abort, parallelOptions };
    const current = round.state.current;
    const busy = [
      ...(current
        ? [{ botId: current, task: this.humanText(chat.id, round.state.rootEntrySeq) }]
        : []),
      ...Array.from(round.parallel.values(), ({ botId, task }) => ({ botId, task })),
    ];
    const input = buildSmartRouteInput(
      chat,
      this.members(chat),
      this.deps.chats
        .readEntries(chat.id, { beforeSeq: entry.seq, limit: SMART_ROUTE_HISTORY_SCAN })
        .filter((item) => item.seq > (chat.epochSeq ?? 0)),
      entry,
      busy
    );
    void this.smartRoute(chat.id, responder, input, abort);
  }

  private humanText(chatId: string, seq: number): string | undefined {
    if (seq <= 0) return undefined;
    const [found] = this.deps.chats.readEntries(chatId, { beforeSeq: seq + 1, limit: 1 });
    return found?.seq === seq && found.kind === 'human' ? found.text : undefined;
  }

  private async routeParallel(
    chat: BotChat,
    entry: HumanEntry,
    options: BotDeliverOptions
  ): Promise<void> {
    const responder = this.deps.responder;
    if (responder && needsSmartRoute(chat, this.members(chat), entry)) {
      this.selectResponders(chat, entry, responder, options);
      return;
    }
    await this.deliverPicked(chat, entry, options, { ids: [] });
  }

  private async deliverPicked(
    chat: BotChat,
    entry: HumanEntry,
    options: BotDeliverOptions,
    decision: SmartRouteDecision
  ): Promise<void> {
    // 仅用临时状态筛选名单与群主兜底，绝不替换主轮。
    const picked = startRound(chat, this.members(chat), entry, decision.ids);
    if (!picked.current) {
      this.system(chat.id, '请先指定群主');
      return;
    }
    const targets = [picked.current, ...picked.queue];
    if (decision.noWriter) this.system(chat.id, '没有能改代码或执行命令的成员，交给群主处理');
    await this.deliverParallel(chat, targets, options, entry, decision);
  }

  private async deliverParallel(
    chat: BotChat,
    targets: BotId[],
    options: BotDeliverOptions,
    entry: HumanEntry,
    decision?: SmartRouteDecision
  ): Promise<void> {
    const round = this.round(chat.id);
    const smart = targets.filter((botId) => decision?.ids.includes(botId));
    const markSmart = smart.length > 1 || (smart.length === 1 && smart[0] !== chat.bossBotId);
    for (const botId of targets) {
      const deliveryId = randomUUID();
      const separate = decision?.separate === true && smart.includes(botId);
      const sent = await this.deliver(
        chat,
        botId,
        { ...options, deliveryId, ...(separate ? { queueIfBusy: true } : {}) },
        decision?.intent === 'build' && decision.ids.length === 1 && decision.ids[0] === botId
          ? SMART_ROUTE_BUILD_NOTE
          : undefined
      );
      const name = this.deps.bots.get(botId)?.name ?? botId;
      if (sent.ok && !sent.duplicate) {
        // 以宿主在会话锁内选择的投递方式为准；群的 current 可能已过期。
        if (sent.steered) continue;
        round.parallel.set(deliveryId, {
          botId,
          conversationId: sent.conversationId,
          task: entry.text,
          ...(markSmart && smart.includes(botId)
            ? {
                routedBy: decision?.intent
                  ? (`smart:${decision.intent}` as const)
                  : ('smart' as const),
              }
            : {}),
        });
        if (sent.steerPending)
          this.system(chat.id, `${name} 正在忙，这条补充会在当前步骤结束后插入`);
        else if (sent.queued)
          this.system(
            chat.id,
            separate
              ? `${name} 正在忙，这条新任务排在当前任务之后`
              : `${name} 正在排队，等待可用会话`
          );
      } else {
        this.system(
          chat.id,
          sent.ok ? `${name} 的投递已处理过，本次未发出` : `${name} 投递失败：${sent.error}`,
          sent.ok ? undefined : { botId, mode: 'deliver' }
        );
      }
    }
  }

  private async smartRoute(
    chatId: string,
    responder: GroupResponderSelector,
    input: SmartRouteInput,
    abort: AbortController
  ): Promise<void> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), responder.timeoutMs());
    const signal = AbortSignal.any([abort.signal, timeout.signal]);
    let decision: SmartRouteDecision = { ids: [] };
    try {
      const cut = new Promise<SmartRouteDecision>((resolve) => {
        if (signal.aborted) resolve({ ids: [] });
        signal.addEventListener('abort', () => resolve({ ids: [] }), { once: true });
      });
      const selecting = Promise.resolve()
        .then(() => responder.select(input, signal))
        .catch((error): SmartRouteDecision => {
          if (!signal.aborted) {
            console.warn('[bots] smart routing failed', error);
            return { ids: [], failure: briefErrorReason(error) };
          }
          return { ids: [] };
        });
      const result = await Promise.race([selecting, cut]);
      if (isDecision(result)) decision = result;
      if (timeout.signal.aborted && !abort.signal.aborted && decision.ids.length === 0) {
        console.warn('[bots] smart routing timed out');
        decision = { ids: [], failure: '选人超时' };
      }
    } finally {
      clearTimeout(timer);
    }
    if (abort.signal.aborted) return;
    await this.lock(chatId, async () => {
      const round = this.rounds.get(chatId);
      const routing = round?.routing;
      if (this.disposed || !round || routing?.abort !== abort) return;
      delete round.routing;
      const chat = this.deps.chats.get(chatId);
      if (chat?.kind !== 'group' || chat.archivedAt !== undefined) {
        this.persist(chatId);
        return;
      }
      if (decision.failure)
        this.system(chatId, `智能选人不可用（${decision.failure}），已交给群主`);
      if (routing.parallelOptions !== undefined) {
        await this.deliverPicked(chat, routing.entry, routing.parallelOptions, decision);
        this.persist(chatId);
        this.settleBatch(chatId);
        return;
      }
      const picked = decision.ids;
      round.state = startRound(chat, this.members(chat), routing.entry, picked);
      const order = [round.state.current, ...round.state.queue];
      const smart = [...new Set(picked)].filter((botId) => order.includes(botId));
      // 只剩群主一人时等同兜底，不标
      if (smart.length > 1 || (smart.length === 1 && smart[0] !== chat.bossBotId)) {
        round.smartPicked = smart;
        if (decision.intent) round.smartIntent = decision.intent;
      }
      if (decision.intent === 'build' && picked.length === 1 && round.state.current === picked[0])
        round.buildNote = picked[0];
      if (decision.noWriter && round.state.current)
        this.system(chatId, '没有能改代码或执行命令的成员，交给群主处理');
      if (!round.state.current) this.system(chatId, '请先指定群主');
      await this.dispatch(chatId);
      this.persist(chatId);
    }).catch((error) => console.warn('[bots] smart routing failed', error));
  }

  private cancelRouting(round: Round): void {
    round.routing?.abort.abort();
    delete round.routing;
  }

  private clearSmart(round: Round): void {
    delete round.allSkipped;
    delete round.smartPicked;
    delete round.smartIntent;
    delete round.buildNote;
    delete round.summary;
  }

  private advance(chat: BotChat, text: string, delegated?: readonly string[], seq?: number): void {
    const round = this.round(chat.id);
    const members = this.members(chat);
    const botId = round.state.current!;
    const result = onReply(round.state, chat, members, {
      botId,
      text,
      ...(delegated?.length ? { delegated } : {}),
      ...(seq !== undefined ? { seq } : {}),
    });
    round.state = result.state;
    if (result.summary)
      round.summary = {
        botId: result.summary.botId,
        note: buildSummaryNote(members, result.summary.reports),
      };
    for (const notice of result.notices) this.system(chat.id, notice);
    if (result.skipped) round.allSkipped?.botIds.push(botId);
    else delete round.allSkipped;
    const skipped = round.allSkipped;
    if (!skipped?.botIds.length || round.state.current || round.pending.length > 0) return;
    const names = skipped.botIds
      .map((id) => `「${members.find((m) => m.id === id)?.name ?? id}」`)
      .join('');
    const boss = members.find((m) => m.id === chat.bossBotId && m.archivedAt === undefined);
    if (
      boss &&
      !skipped.forwarded &&
      !skipped.botIds.includes(boss.id) &&
      round.state.hops < chat.routing.maxHops &&
      (round.state.turnsByBot[boss.id] ?? 0) < chat.routing.maxTurnsPerBot
    ) {
      skipped.forwarded = true;
      round.state = {
        ...round.state,
        current: boss.id,
        hops: round.state.hops + 1,
        turnsByBot: {
          ...round.state.turnsByBot,
          [boss.id]: (round.state.turnsByBot[boss.id] ?? 0) + 1,
        },
      };
      this.system(chat.id, `${names}已跳过，交给群主「${boss.name}」回复。`);
    } else {
      delete round.allSkipped;
      this.system(chat.id, `${names}已跳过，本轮无人回复。`);
    }
  }

  private async dispatch(chatId: string): Promise<void> {
    const round = this.round(chatId);
    if (this.disposed || (round.routing && round.routing.parallelOptions === undefined)) return;
    if (!round.state.current) {
      const job = this.autonomous.get(chatId)?.shift();
      if (job) {
        const chat = this.deps.chats.get(chatId);
        const bot = this.deps.bots.get(job.botId);
        if (
          !chat ||
          chat.archivedAt !== undefined ||
          !chat.members.includes(job.botId) ||
          !bot ||
          bot.archivedAt !== undefined
        ) {
          job.resolve({ ok: false, error: 'routine-target-unavailable' });
          return this.dispatch(chatId);
        }
        if (job.title !== undefined) this.system(chatId, `例行任务：${job.title}`);
        this.clearSmart(round);
        round.state = { ...empty(), current: job.botId, turnsByBot: { [job.botId]: 1 } };
        round.options = { ...job.options, queueIfBusy: true };
        round.deliveryId = round.options.deliveryId ?? randomUUID();
        round.generation++;
        // 委派结果 / 例行任务不经路由，也要补上该成员没看过的群消息，否则会基于过时群况回复
        const sent = await this.deliver(
          chat,
          job.botId,
          { ...round.options, deliveryId: round.deliveryId },
          undefined,
          job.text
        );
        job.resolve(sent);
        round.options = relayOptions(round.options);
        if (sent.ok && !sent.duplicate) {
          this.persist(chatId);
          return;
        }
        if (sent.ok) this.system(chatId, `${bot.name} 的投递已处理过，本次未发出`);
        else if (sent.error === BOT_BUDGET_ERROR) this.system(chatId, budgetNotice(bot.name));
        round.state = empty();
        return this.dispatch(chatId);
      }
    }
    let unavailable = false;
    while (round.state.current) {
      const chat = this.deps.chats.get(chatId);
      if (!chat || chat.archivedAt !== undefined) {
        round.state = empty();
        break;
      }
      const botId = round.state.current;
      const bot = this.deps.bots.get(botId);
      if (!bot || bot.archivedAt !== undefined || !chat.members.includes(botId)) {
        unavailable = true;
        this.advance(chat, '');
        continue;
      }
      round.generation++;
      this.persist(chatId);
      const summary = round.summary?.botId === botId ? round.summary.note : undefined;
      if (summary !== undefined) round.summary = { botId };
      const note = round.buildNote === botId ? SMART_ROUTE_BUILD_NOTE : summary;
      delete round.buildNote;
      round.deliveryId = round.options?.deliveryId ?? randomUUID();
      const sent = await this.deliver(
        chat,
        botId,
        {
          ...round.options,
          deliveryId: round.deliveryId,
          ...(Array.from(round.parallel.values()).some((delivery) => delivery.botId === botId)
            ? { queueIfBusy: true }
            : {}),
        },
        note
      );
      round.options = relayOptions(round.options);
      if (sent.ok && !sent.duplicate) return;
      if (round.summary?.botId === botId) delete round.summary;
      this.system(
        chatId,
        sent.ok
          ? `${bot.name} 的投递已处理过，本次未发出`
          : sent.error === BOT_BUDGET_ERROR
            ? budgetNotice(bot.name)
            : `${bot.name} 暂时无法回复${
                sent.error && !/^[a-z0-9-]+$/.test(sent.error) ? `（${sent.error}）` : ''
              }`,
        sent.ok ? undefined : { botId, mode: 'deliver' }
      );
      this.advance(chat, '');
    }
    if (unavailable) this.system(chatId, '请先指定群主');
    if (this.autonomous.get(chatId)?.length) await this.dispatch(chatId);
  }

  /** 成员会话压缩成功：仅群聊里该成员的当前会话生效 */
  markCompacted(chatId: string, botId: string, conversationId: string): void {
    const chat = this.deps.chats.get(chatId);
    if (chat?.kind === 'group' && chat.sessions[botId]?.conversationId === conversationId)
      this.compacted.set(conversationId, { chatId, botId });
  }

  clearCompacted(scope: { chatId?: string; botId?: string; conversationId?: string }): void {
    if (scope.conversationId) this.compacted.delete(scope.conversationId);
    for (const [id, mark] of this.compacted)
      if (mark.chatId === scope.chatId || mark.botId === scope.botId) this.compacted.delete(id);
  }

  private stateBlock(chat: BotChat, botId: string): string {
    const extra = this.deps.groupState?.(chat.id);
    const { state } = this.round(chat.id);
    return buildGroupStateBlock({
      chatTitle: chat.title,
      selfId: botId,
      members: this.members(chat),
      bossBotId: chat.bossBotId,
      routing: { current: state.current, queue: state.queue },
      delegations: extra?.delegations ?? [],
      tasks: extra?.tasks ?? [],
      lastSeq: this.deps.chats.lastSeq(chat.id),
    });
  }

  private async deliver(
    chat: BotChat,
    botId: string,
    options?: BotDeliverOptions,
    note?: string,
    lead?: string
  ) {
    const cursor = chat.sessions[botId]?.cursor ?? 0;
    // 排队尚未提交水位，但后续投递不能再次携带已排队的消息。
    let queuedCursor = cursor;
    for (const pending of this.cursors.values())
      if (pending.chatId === chat.id && pending.botId === botId)
        queuedCursor = Math.max(queuedCursor, pending.cursor);
    const floor = chat.epochSeq ?? 0;
    const entries = this.deps.chats.readAfter(chat.id, Math.max(queuedCursor, floor));
    const delta = buildGroupDelta({
      entries,
      botId,
      cursor: queuedCursor,
      floor,
      members: this.members(chat),
      chatTitle: chat.title,
    });
    const sessionId = chat.sessions[botId]?.conversationId;
    const compacted = sessionId !== undefined && this.compacted.has(sessionId);
    const appendix = this.deps.refsAppendix
      ? await this.deps.refsAppendix(chat, botId, entries).catch(() => '')
      : '';
    const text = [
      // lead 必须在最前：委派结果靠开头的 <delegation-result id> 判断是否已投递
      lead,
      compacted ? this.stateBlock(chat, botId) : '',
      delta.text,
      appendix,
      note ? `<routing-note>${note}</routing-note>` : '',
    ]
      .filter(Boolean)
      .join('\n');
    let result: BotDeliverResult;
    const deliveryId = options?.deliveryId ?? randomUUID();
    const pending: { chatId: string; botId: string; cursor: number; steered?: true } = {
      chatId: chat.id,
      botId,
      cursor: delta.cursor,
    };
    this.cursors.set(deliveryId, pending);
    try {
      result = await this.deps.host.deliver(chat.id, botId, text, { ...options, deliveryId });
    } catch (error) {
      result = {
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    // ensureSession 首建会话会设到末尾；失败也要恢复投递前水位。
    this.deps.chats.update(chat.id, (draft) => {
      const session = draft.sessions[botId];
      if (session)
        session.cursor = Math.max(
          session.conversationId === sessionId ? session.cursor : cursor,
          result.ok && !result.queued && !result.duplicate ? delta.cursor : cursor
        );
      return draft;
    });
    if (!result.ok || !result.queued) this.cursors.delete(deliveryId);
    if (compacted && result.ok && !result.duplicate) this.compacted.delete(sessionId);
    // 排队任务可能在 deliver 返回前已被 pump 转为 steer。
    return result.ok && pending.steered ? { ...result, steered: true } : result;
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.unsubscribeSent();
    for (const id of this.rounds.keys()) {
      for (const job of this.autonomous.get(id) ?? [])
        job.resolve({ ok: false, error: 'canceled' });
      this.cancelRouting(this.round(id));
      this.rounds.set(id, { state: empty(), pending: [], generation: 0, parallel: new Map() });
      this.persist(id);
    }
    this.rounds.clear();
    this.autonomous.clear();
    this.cursors.clear();
    this.compacted.clear();
  }

  discard(chatId: string): void {
    for (const job of this.autonomous.get(chatId) ?? [])
      job.resolve({ ok: false, error: 'canceled' });
    this.autonomous.delete(chatId);
    const round = this.rounds.get(chatId);
    if (round) this.cancelRouting(round);
    this.rounds.delete(chatId);
    for (const [id, cursor] of this.cursors) if (cursor.chatId === chatId) this.cursors.delete(id);
    this.clearCompacted({ chatId });
  }

  private members(chat: BotChat) {
    return chat.members.flatMap((id) => {
      const bot = this.deps.bots.get(id);
      return bot ? [bot] : [];
    });
  }
  private round(id: string): Round {
    let round = this.rounds.get(id);
    if (!round) {
      round = { state: empty(), pending: [], generation: 0, parallel: new Map() };
      this.rounds.set(id, round);
    }
    return round;
  }
  private file(id: string) {
    return join(dirname(this.deps.chats.workspaceDir(id)), 'router.json');
  }
  private persist(id: string): void {
    if (!this.deps.chats.get(id)) return;
    const { state, pending, parallel } = this.round(id);
    writeJsonAtomic(this.file(id), {
      version: 1,
      state,
      pending,
      parallel: [...new Set(Array.from(parallel.values(), (delivery) => delivery.botId))],
    });
    this.deps.emit({ kind: 'chat', chatId: id });
  }
  private append(id: string, entry: GroupEntryInput) {
    const saved = this.deps.chats.appendEntry(id, entry);
    if (saved) this.deps.emit({ kind: 'timeline', chatId: id, seq: saved.seq });
    return saved;
  }
  private system(
    id: string,
    text: string,
    failure?: Extract<GroupEntry, { kind: 'system' }>['failure']
  ): void {
    this.append(id, {
      kind: 'system',
      id: randomUUID(),
      at: Date.now(),
      text,
      ...(failure ? { failure } : {}),
    });
  }
  private lock<T>(id: string, task: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(id) ?? Promise.resolve()).then(task, task);
    const settled = run.catch(() => {});
    this.locks.set(id, settled);
    void settled.then(() => {
      if (this.locks.get(id) === settled) this.locks.delete(id);
    });
    return run;
  }
}
