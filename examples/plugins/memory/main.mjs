import { createHash } from 'node:crypto';
import { createAutomation } from './automation.mjs';
import { buildContext, isObject, localDate } from './domain.mjs';
import { normalizeArguments } from './params.mjs';
import { createMemoryService } from './service.mjs';

/** Valid JSON, bounded tool previews; full single-record reads remain available via id. */
function toolResult(value, args) {
  const result = structuredClone(value);
  for (const field of ['items', 'results']) {
    if (!Array.isArray(result[field])) continue;
    if (!args.id)
      for (const row of result[field]) {
        for (const key of ['content', 'text'])
          if (typeof row?.[key] === 'string' && row[key].length > 260) {
            row[key] = `${row[key].slice(0, 260)}…`;
            row.preview = true;
          }
        if (field === 'results') delete row.content;
      }
    while (JSON.stringify(result).length > 3900 && result[field].length > 1) {
      result[field].pop();
      result.nextOffset = (args.offset ?? 0) + result[field].length;
      result.truncated = true;
    }
  }
  const json = JSON.stringify(result);
  if (json.length > 4000)
    return {
      content: JSON.stringify({
        ok: false,
        error: '结果超过预览预算，请缩小 limit 或使用 id 读取单条',
        truncated: true,
      }),
    };
  return { content: json };
}

export function activate(enso) {
  const service = createMemoryService(enso.dataDir);
  const snapshots = new Map();
  const deliveries = new Map();
  const sendingTodos = new Set();
  let sweptAt = 0;
  const report = async (title, error) => {
    try {
      await enso.ui.notify(title, String(error?.message ?? error).slice(0, 500));
    } catch {
      console.warn(`[memory] ${title}: ${error?.message ?? error}`);
    }
  };
  const changed = async () => {
    snapshots.clear();
    try {
      await enso.ui.view.emit('memory-changed', {});
    } catch (error) {
      console.warn(`[memory] view update: ${error.message}`);
    }
    // 图片是独立文件：删除/清理后回收不再被引用的孤儿文件，十分钟一次即可。
    if (Date.now() - sweptAt < 10 * 60_000) return;
    sweptAt = Date.now();
    try {
      await service.cleanupAttachments();
    } catch (error) {
      console.warn(`[memory] 图片清理: ${error.message}`);
    }
  };
  const automation = createAutomation(enso, service, { changed, report });
  const operations = {
    memory_write: service.write,
    memory_read: service.read,
    memory_search: service.find,
    memory_forget: service.forget,
    memory_restore: service.restore,
    scratchpad: service.scratchpad,
    memory_status: service.status,
  };
  const writes = new Set(['memory_write', 'memory_forget', 'memory_restore', 'scratchpad']);
  for (const [name, operation] of Object.entries(operations)) {
    enso.tools.register(name, async (args, ctx) => {
      try {
        args = normalizeArguments(name, args);
        const result = await operation(args, ctx);
        if (
          writes.has(name) &&
          !(name === 'scratchpad' && (!args.action || args.action === 'list'))
        )
          await changed();
        return toolResult(result, args);
      } catch (error) {
        return { content: JSON.stringify({ ok: false, error: error.message }) };
      }
    });
  }
  const methods = {
    status: async (args, ctx) => ({
      ...(await service.status(args, ctx)),
      model: (await enso.config.get()).model ?? 'session',
    }),
    context: (args, ctx) => service.context(args, ctx),
    read: (args, ctx) => service.read({ ...args, limit: Math.min(args.limit ?? 6, 6) }, ctx),
    search: (args, ctx) => service.find({ ...args, limit: Math.min(args.limit ?? 6, 6) }, ctx),
    trash: service.trash,
    save: (args, ctx) => service.write(args, ctx, 'user'),
    forget: service.forget,
    restore: service.restore,
    scratchpad: service.scratchpad,
    attachment: service.attachment,
    attachment_save: (args) => service.saveImage(args),
    /** Copying is not execution and must not change a task's status. */
    copy_todo: async (args = {}, ctx = {}) => {
      const payload = await service.todoInstruction(args, ctx);
      await enso.ui.clipboard.writeText(payload.text);
      return { characters: payload.text.length, images: payload.images, text: payload.text };
    },
    sessions: async (_args, ctx) => {
      if (!ctx.projectRoot) return { current: null, sessions: [], error: 'select-project' };
      const result = await enso.session.list({ scope: 'workspace' });
      return { ...result, sessions: result.sessions.filter((session) => !session.archived) };
    },
    send_todo: (args, ctx) => {
      if (!ctx.projectRoot) throw new Error('请先在顶部选择本地项目，再选择接收待办的会话');
      if (typeof args.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(args.sessionId))
        throw new Error('会话标识无效');
      if (typeof args.deliveryId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(args.deliveryId))
        throw new Error('投递标识无效');
      if (
        args.deliverAs !== undefined &&
        args.deliverAs !== 'followUp' &&
        args.deliverAs !== 'steer'
      )
        throw new Error('投递方式无效');
      const key = `${ctx.projectRoot}\0${args.deliveryId}`;
      const signature = JSON.stringify([args.id, args.sessionId, args.note, args.deliverAs]);
      const previous = deliveries.get(key);
      if (previous) {
        if (previous.signature !== signature)
          throw new Error('投递标识已用于另一条请求，请重新打开发送窗口');
        return previous.promise;
      }
      const todoKey = `${ctx.projectRoot}\0${args.id}`;
      if (sendingTodos.has(todoKey))
        throw new Error('这条待办正在发送，请等待接收结果，不要重复发送');
      if (deliveries.size >= 100) {
        const oldest = [...deliveries].find(([, entry]) => entry.settled);
        if (!oldest) throw new Error('待确认的投递过多，请稍后再试');
        deliveries.delete(oldest[0]);
      }
      const entry = { signature, settled: false, promise: null };
      sendingTodos.add(todoKey);
      entry.promise = Promise.resolve()
        .then(async () => {
          const { sessions } = await enso.session.list({ scope: 'workspace' });
          if (!sessions.some((session) => session.id === args.sessionId && !session.archived))
            throw new Error('目标会话已移除或不属于当前项目/工作区，请重新选择');
          const payload = await service.todoForSend(args, ctx);
          await enso.session.inject({
            sessionId: args.sessionId,
            text: payload.text,
            images: payload.images,
            deliverAs: args.deliverAs ?? 'followUp',
            triggerTurn: true,
            sameWorkspace: true,
          });
          const marked = await service.markTodoSent(
            { id: payload.id, expected: payload.expected },
            ctx
          );
          return {
            ok: true,
            sessionId: args.sessionId,
            images: payload.images.length,
            status: marked.status,
          };
        })
        .finally(() => {
          entry.settled = true;
          sendingTodos.delete(todoKey);
        });
      deliveries.set(key, entry);
      return entry.promise;
    },
    settings: service.settings,
    clear: (args, ctx) => {
      if (args?.confirm !== 'CLEAR') throw new Error('清空需要明确确认');
      return service.clear(args, ctx);
    },
    copy_markdown: async (_args, ctx) => {
      const text = await service.markdown(ctx);
      await enso.ui.clipboard.writeText(text);
      return { copied: true, characters: text.length };
    },
    copy_context: async (_args, ctx) => {
      const { text } = await service.context({}, ctx);
      await enso.ui.clipboard.writeText(text);
      return { copied: true, characters: text.length };
    },
    export_backup: async (_args, ctx) => {
      // Only export the invoking project's visible records, not another project's private data.
      const state = await service.state();
      const included = (row) => row.projectKey === null || row.projectKey === ctx.projectRoot;
      for (const type of ['memories', 'todos', 'logs']) state[type] = state[type].filter(included);
      state.recovery = state.recovery.filter((row) =>
        row.records.every((item) => included(item.record))
      );
      return enso.artifacts.write({
        name: `memory-backup-${localDate()}.json`,
        text: JSON.stringify(state, null, 2),
        mime: 'application/json',
      });
    },
    analyze: (_args, ctx) => automation.analyze(ctx, true),
  };
  for (const [name, method] of Object.entries(methods)) {
    enso.renderer.handle(name, async (args = {}, ctx) => {
      if (!isObject(args)) throw new Error('参数必须为对象');
      const result = await method(args, ctx);
      if (
        ['save', 'forget', 'restore', 'scratchpad', 'send_todo', 'settings', 'clear'].includes(name)
      )
        await changed();
      return result;
    });
  }
  enso.commands.register('open', () => enso.ui.view.open('memory'));
  // 上次异常退出可能留下没有引用的图片文件，启动后补一次扫描。
  void service
    .cleanupAttachments()
    .catch((error) => console.warn(`[memory] 图片清理: ${error.message}`));
  const safe = (handler) => async (data, ctx) => {
    try {
      return await handler(data, ctx);
    } catch (error) {
      await report('记忆插件', error);
      return undefined;
    }
  };
  enso.events.on(
    'before_agent_start',
    safe(async (data, ctx) => {
      if (!ctx?.sessionId || ctx.agent || ctx.caller) return;
      automation.prompt(data, ctx);
      const state = await service.state();
      if (!state.settings.enabled) return;
      const digest = createHash('sha256').update(JSON.stringify(state)).digest('hex');
      const key = `${ctx.projectRoot ?? ''}:${localDate()}:${digest}`;
      const cached = snapshots.get(ctx.sessionId);
      if (state.settings.mode === 'stable' && cached?.key === key) return { append: cached.text };
      const text = buildContext(state, ctx.projectRoot ?? null, data?.prompt ?? '');
      if (snapshots.size >= 128) snapshots.delete(snapshots.keys().next().value);
      snapshots.set(ctx.sessionId, { key, text });
      return text ? { append: text } : undefined;
    })
  );
  enso.events.on(
    'session_start',
    safe((data, ctx) => {
      snapshots.delete(ctx.sessionId);
      automation.start(data, ctx);
    })
  );
  enso.events.on('agent_end', safe(automation.end));
  enso.events.on('before_compact', safe(automation.compact));
  enso.events.on(
    'after_compact',
    safe((_data, ctx) => {
      snapshots.delete(ctx.sessionId);
    })
  );
  enso.events.on(
    'session_end',
    safe(async (data, ctx) => {
      snapshots.delete(ctx.sessionId);
      await automation.close(data, ctx);
    })
  );
}
