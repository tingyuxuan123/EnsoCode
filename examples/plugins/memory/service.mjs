import { createHash, randomUUID } from 'node:crypto';
import { createAttachmentStore } from './attachments.mjs';
import {
  boolean,
  content,
  contextSections,
  DAILY_KINDS,
  enumValue,
  integer,
  isObject,
  KINDS,
  LIMITS,
  localDate,
  looksSensitive,
  newest,
  parseSettings,
  search,
  similar,
  TODO_IMAGE_LIMIT,
  TODO_STATUSES,
  validDate,
  visible,
} from './domain.mjs';
import { createStorage } from './storage.mjs';

const shortId = (value) => {
  if (typeof value !== 'string' || !/^[a-z0-9-]{1,80}$/.test(value))
    throw new Error('记录 ID 无效');
  return value;
};
/** 只带图片的待办也要有正文：占位文本让注入、导出和检索都有可读内容。 */
const IMAGE_ONLY_TEXT = '（图片）';
const todoText = (value, hasImages) =>
  hasImages && (value === undefined || (typeof value === 'string' && !value.trim()))
    ? IMAGE_ONLY_TEXT
    : content(value);
const instructionFor = (row, value) => {
  if (value !== undefined && typeof value !== 'string') throw new Error('说明须为文本');
  const note = value?.trim() ?? '';
  if (note.length > 2000) throw new Error('说明最多 2000 字符');
  const images = row.images?.length ?? 0;
  return {
    text: [
      note || row.text,
      '',
      `—— 来自 CodeKiln 记忆的待办（id: ${row.id}）`,
      ...(images ? [`这条待办在记忆里还挂着 ${images} 张图片，请按图核对。`] : []),
      `完成后请调用记忆插件的 scratchpad 工具（plugin_codekiln-memory__scratchpad）把这条待办标为已完成：action=done, id=${row.id}。`,
      `需要改写待办正文时用 action=edit, id=${row.id}, text=新的正文（已有图片会保留）。`,
      '暂时做不完就用 action=start 保持进行中，或 action=undo 退回待办，并说明原因。',
    ].join('\n'),
    images,
    todo: { id: row.id, text: row.text },
  };
};
const projectOf = (ctx) =>
  typeof ctx?.projectRoot === 'string' && ctx.projectRoot ? ctx.projectRoot : null;
const argsOf = (args) => {
  if (!isObject(args)) throw new Error('参数必须为对象');
  return args;
};
function owner(scope, ctx) {
  const selected = enumValue(scope, ['global', 'project'], projectOf(ctx) ? 'project' : 'global');
  const projectKey = selected === 'global' ? null : projectOf(ctx);
  if (selected === 'project' && !projectKey)
    throw new Error('项目记忆必须在本机 Code 项目会话中创建');
  return { scope: selected, projectKey };
}
const allowed = (row, ctx) => visible(row, projectOf(ctx));
const epochKey = (project) =>
  project === null ? 'global' : createHash('sha256').update(project).digest('hex');
const invalidate = (state, project) => {
  const key = epochKey(project);
  state.epochs[key] = (state.epochs[key] ?? 0) + 1;
};
const analysisToken = (state, ctx) =>
  `${state.epochs.global ?? 0}:${state.epochs[epochKey(projectOf(ctx))] ?? 0}`;
const ensureEnabled = (state) => {
  if (!state.settings.enabled) throw new Error('记忆已暂停，请在记忆设置中启用');
};
const capacity = (state, type, count = 1) => {
  if (state[type].length + count > LIMITS[type])
    throw new Error(`${type} 已达 ${LIMITS[type]} 条上限，请先导出并整理，不会自动淘汰数据`);
};
function page(rows, args) {
  const offset = integer(args.offset, 0, 100000, 0);
  const limit = integer(args.limit, 1, 50, 20);
  const items = rows.slice(offset, offset + limit);
  return {
    count: rows.length,
    items,
    nextOffset: offset + items.length < rows.length ? offset + items.length : null,
  };
}

function removeRecords(state, items, now, reason) {
  if (!items.length) return { removed: 0, recoveryId: null };
  // A restored batch is redundant history; never expire an unrestored deletion.
  if (state.recovery.length >= LIMITS.recovery)
    state.recovery = state.recovery.filter((entry) => entry.restoredAt === null);
  capacity(state, 'recovery');
  const entry = {
    id: randomUUID(),
    deletedAt: now,
    restoredAt: null,
    reason,
    records: structuredClone(items),
  };
  state.recovery.unshift(entry);
  for (const project of new Set(items.map((item) => item.record.projectKey)))
    invalidate(state, project);
  for (const type of ['memories', 'todos', 'logs']) {
    const ids = new Set(items.filter((item) => item.type === type).map((item) => item.record.id));
    state[type] = state[type].filter((row) => !ids.has(row.id));
  }
  return { removed: items.length, recoveryId: entry.id };
}

export function createMemoryService(directory, { now = Date.now, attachmentMinAgeMs } = {}) {
  const storage = createStorage(directory);
  const attachments = createAttachmentStore(directory, { minAgeMs: attachmentMinAgeMs });
  const readState = () => storage.load();
  const base = (args, ctx, source) => ({
    id: randomUUID(),
    ...owner(args.scope, ctx),
    source,
    createdAt: now(),
    updatedAt: now(),
  });
  /** 图片归属：已认领的图只允许原待办继续引用，避免按猜测的 ID 抢别的项目的图。 */
  const claimedImages = (state) => {
    const owners = new Map();
    for (const row of state.todos)
      for (const image of row.images ?? []) {
        if (!owners.has(image.id)) owners.set(image.id, new Set());
        owners.get(image.id).add(row.id);
      }
    return owners;
  };
  const resolveImages = async (state, value, row) => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > TODO_IMAGE_LIMIT)
      throw new Error(`每条待办最多 ${TODO_IMAGE_LIMIT} 张图片`);
    const ids = value.map(shortId);
    if (new Set(ids).size !== ids.length) throw new Error('图片引用重复');
    const owners = claimedImages(state);
    const images = [];
    for (const id of ids) {
      const claimed = owners.get(id);
      if (claimed && (!row || !claimed.has(row.id))) throw new Error('图片已被其他待办使用');
      const meta = await attachments.describe(id).catch(() => null);
      if (!meta) throw new Error('图片不存在或已被清理，请重新粘贴');
      images.push(meta);
    }
    return images;
  };
  const service = {
    state: readState,
    analysisToken,
    async write(input = {}, ctx = {}, source = 'agent') {
      const args = argsOf(input);
      const text = content(args.content);
      const target = enumValue(args.target, ['long_term', 'daily'], 'long_term');
      return storage.transaction((state) => {
        ensureEnabled(state);
        if (target === 'daily') {
          const kind = enumValue(args.kind, DAILY_KINDS, undefined);
          if (args.id !== undefined) {
            const row = state.logs.find(
              (item) => item.id === shortId(args.id) && allowed(item, ctx)
            );
            if (!row) throw new Error('日志不存在或不属于当前项目');
            Object.assign(row, { text, updatedAt: now(), ...(kind ? { kind } : {}) });
            invalidate(state, row.projectKey);
            return { ok: true, action: 'updated', entry: row };
          }
          capacity(state, 'logs');
          const record = {
            ...base(args, ctx, source),
            date: localDate(now()),
            kind: kind ?? 'note',
            text,
          };
          state.logs.push(record);
          invalidate(state, record.projectKey);
          return { ok: true, action: 'logged', entry: record };
        }
        const kind = enumValue(args.kind, KINDS, undefined);
        const pinned = boolean(args.pinned, undefined);
        if (args.id !== undefined) {
          const row = state.memories.find(
            (item) => item.id === shortId(args.id) && allowed(item, ctx)
          );
          if (!row) throw new Error('记录不存在或不属于当前项目');
          Object.assign(row, {
            content: text,
            updatedAt: now(),
            ...(kind ? { kind } : {}),
            ...(pinned !== undefined ? { pinned } : {}),
          });
          invalidate(state, row.projectKey);
          return { ok: true, action: 'updated', memory: row };
        }
        const ownership = owner(args.scope, ctx);
        const existing = state.memories.find(
          (row) => row.projectKey === ownership.projectKey && similar(row.content, text)
        );
        if (existing) {
          existing.content = text.length > existing.content.length ? text : existing.content;
          existing.pinned = existing.pinned || pinned === true;
          existing.kind = kind ?? existing.kind;
          existing.updatedAt = now();
          invalidate(state, existing.projectKey);
          return { ok: true, action: 'merged-with-existing', memory: existing };
        }
        capacity(state, 'memories');
        const row = {
          ...base(args, ctx, source),
          content: text,
          kind: kind ?? 'fact',
          pinned: pinned ?? false,
        };
        state.memories.push(row);
        invalidate(state, row.projectKey);
        return { ok: true, action: 'created', memory: row };
      });
    },
    async read(input = {}, ctx = {}) {
      const args = argsOf(input),
        state = await readState();
      ensureEnabled(state);
      const target = enumValue(
        args.target,
        ['long_term', 'daily', 'scratchpad', 'list_daily'],
        'long_term'
      );
      if (target === 'list_daily') {
        const dates = [
          ...new Set(state.logs.filter((row) => allowed(row, ctx)).map((row) => row.date)),
        ]
          .sort()
          .reverse();
        return { ...page(dates, args), dates: dates.slice(0, 60) };
      }
      let rows =
        target === 'long_term' ? state.memories : target === 'daily' ? state.logs : state.todos;
      rows = rows.filter((row) => allowed(row, ctx));
      const date = target === 'daily' ? validDate(args.date ?? localDate(now())) : null;
      const id = args.id !== undefined ? shortId(args.id) : null;
      const kind = enumValue(args.kind, target === 'daily' ? DAILY_KINDS : KINDS, undefined);
      const scope = enumValue(args.scope, ['global', 'project'], undefined);
      const done = boolean(args.done, undefined);
      const status = enumValue(args.status, TODO_STATUSES, undefined);
      if (date) rows = rows.filter((row) => row.date === date);
      if (id) rows = rows.filter((row) => row.id === id);
      if (kind) rows = rows.filter((row) => row.kind === kind);
      if (scope) rows = rows.filter((row) => row.scope === scope);
      if (done !== undefined && target === 'scratchpad')
        rows = rows.filter((row) => (row.status === 'done') === done);
      if (status !== undefined && target === 'scratchpad')
        rows = rows.filter((row) => row.status === status);
      return page(
        rows.sort(
          (a, b) =>
            Number(b.pinned) - Number(a.pinned) ||
            Number(b.status === 'doing') - Number(a.status === 'doing') ||
            newest(a, b)
        ),
        args
      );
    },
    async find(input = {}, ctx = {}) {
      const args = argsOf(input),
        state = await readState();
      ensureEnabled(state);
      const query = args.query ?? '';
      if (typeof query !== 'string' || query.length > 200)
        throw new Error('检索词须为不超过 200 字符的文本');
      const sources = args.sources ?? ['memory', 'daily', 'scratchpad'];
      if (
        !Array.isArray(sources) ||
        sources.length > 3 ||
        sources.some((item) => !['memory', 'daily', 'scratchpad'].includes(item))
      )
        throw new Error('检索来源无效');
      const kind = enumValue(args.kind, KINDS, undefined);
      const documents = [];
      for (const [source, type] of [
        ['memory', 'memories'],
        ['daily', 'logs'],
        ['scratchpad', 'todos'],
      ]) {
        if (!sources.includes(source) || (kind && source !== 'memory')) continue;
        for (const row of state[type]) {
          if (allowed(row, ctx) && (!kind || row.kind === kind))
            documents.push({ ...row, source, text: row.content ?? row.text });
        }
      }
      const found = page(search(documents, query), { ...args, limit: args.limit ?? 10 });
      return {
        count: found.count,
        results: found.items.map(({ content: _content, ...row }) => row),
        nextOffset: found.nextOffset,
        search: 'BM25 keyword (Latin / CJK / #tag / [[link]]); not semantic',
      };
    },
    async forget(input, ctx = {}) {
      const args = argsOf(input);
      if (!Array.isArray(args.ids) || !args.ids.length || args.ids.length > 20)
        throw new Error('ids 须含 1–20 个记录 ID');
      const ids = new Set(args.ids.map(shortId));
      const target = enumValue(args.target, ['long_term', 'daily', 'scratchpad'], 'long_term');
      const type = { long_term: 'memories', daily: 'logs', scratchpad: 'todos' }[target];
      return storage.transaction((state) => {
        ensureEnabled(state);
        const rows = state[type].filter((row) => ids.has(row.id) && allowed(row, ctx));
        return {
          ...removeRecords(
            state,
            rows.map((record) => ({ type, record })),
            now(),
            'delete'
          ),
          notFound: [...ids].filter((id) => !rows.some((row) => row.id === id)),
        };
      });
    },
    async restore(input, ctx = {}) {
      const args = argsOf(input),
        id = shortId(args.recoveryId);
      return storage.transaction((state) => {
        ensureEnabled(state);
        const entry = state.recovery.find((row) => row.id === id);
        if (!entry || entry.records.some((item) => !allowed(item.record, ctx)))
          throw new Error('恢复记录不存在或不属于当前项目');
        if (entry.restoredAt !== null) return { restored: 0, alreadyRestored: true };
        const missing = entry.records.filter(
          (item) => !state[item.type].some((row) => row.id === item.record.id)
        );
        for (const type of ['memories', 'logs', 'todos'])
          capacity(state, type, missing.filter((item) => item.type === type).length);
        for (const item of missing) state[item.type].push(structuredClone(item.record));
        for (const project of new Set(missing.map((item) => item.record.projectKey)))
          invalidate(state, project);
        entry.restoredAt = now();
        return { restored: missing.length };
      });
    },
    async scratchpad(input = {}, ctx = {}) {
      const args = argsOf(input);
      const action = enumValue(
        args.action,
        ['add', 'start', 'done', 'undo', 'remove', 'clear_done', 'list', 'edit'],
        'list'
      );
      if (action === 'list') return service.read({ ...args, target: 'scratchpad' }, ctx);
      return storage.transaction(async (state) => {
        ensureEnabled(state);
        if (action === 'add') {
          capacity(state, 'todos');
          const images = (await resolveImages(state, args.images)) ?? [];
          const row = {
            ...base(args, ctx, 'user'),
            text: todoText(args.text, images.length > 0),
            status: 'todo',
            ...(images.length ? { images } : {}),
          };
          state.todos.push(row);
          invalidate(state, row.projectKey);
          return { added: row };
        }
        if (action === 'clear_done')
          return removeRecords(
            state,
            state.todos
              .filter((row) => allowed(row, ctx) && row.status === 'done')
              .map((record) => ({ type: 'todos', record })),
            now(),
            'clear-done'
          );
        const row = state.todos.find((item) => item.id === shortId(args.id) && allowed(item, ctx));
        if (!row) throw new Error('待办不存在或不属于当前项目');
        if (action === 'remove')
          return removeRecords(state, [{ type: 'todos', record: row }], now(), 'delete');
        if (action === 'edit') {
          const images = await resolveImages(state, args.images, row);
          const next = images ?? row.images ?? [];
          const status = enumValue(args.status, TODO_STATUSES, undefined);
          row.text = todoText(args.text ?? (next.length ? row.text : undefined), next.length > 0);
          if (status) row.status = status;
          if (images) {
            if (images.length) row.images = images;
            else delete row.images;
          }
        } else row.status = action === 'start' ? 'doing' : action === 'done' ? 'done' : 'todo';
        row.updatedAt = now();
        invalidate(state, row.projectKey);
        return { item: row };
      });
    },
    /** 渲染层把压缩后的图片以 base64 交上来；只按文件头判定格式，文件名不带扩展名。 */
    async saveImage(input = {}) {
      const args = argsOf(input);
      ensureEnabled(await readState());
      return attachments.put({ data: args.data, thumb: args.thumb });
    },
    /** 只服务当前可见待办引用过的图片；返回缩略图，`full` 用于大图预览。 */
    async attachment(input = {}, ctx = {}) {
      const args = argsOf(input);
      if (!Array.isArray(args.ids) || !args.ids.length || args.ids.length > TODO_IMAGE_LIMIT)
        throw new Error(`ids 须含 1–${TODO_IMAGE_LIMIT} 个图片 ID`);
      const full = boolean(args.full, false);
      const state = await readState();
      ensureEnabled(state);
      const visibleIds = new Set();
      for (const row of state.todos) {
        if (!allowed(row, ctx)) continue;
        for (const image of row.images ?? []) visibleIds.add(image.id);
      }
      const items = [];
      const missing = [];
      let budget = 0;
      for (const raw of args.ids) {
        const id = shortId(raw);
        const found = visibleIds.has(id) ? await attachments.get(id, { full }) : null;
        const encoded = found?.data.toString('base64') ?? '';
        // 宿主一次 UI 调用限 1MB：单次响应留出余量，剩下的让渲染层再要一次。
        if (!found || budget + encoded.length > 900_000) {
          missing.push(id);
          continue;
        }
        budget += encoded.length;
        items.push({
          id,
          mime: found.mime,
          bytes: found.bytes,
          dataUrl: `data:${found.mime};base64,${encoded}`,
        });
      }
      return { items, missing };
    },
    /** 待办与回收站都不再引用的图片文件才删；新写入的文件由存储层自己保护。 */
    async cleanupAttachments() {
      const state = await readState();
      const referenced = new Set();
      for (const row of state.todos) for (const image of row.images ?? []) referenced.add(image.id);
      for (const entry of state.recovery)
        for (const item of entry.records)
          for (const image of item.record?.images ?? []) referenced.add(image.id);
      return attachments.sweep(referenced);
    },
    /**
     * 把一条待办整理成可以直接粘进会话的指令：正文（可替换说明）+ 待办 ID + 完成/改写动作。
     * 复制只输出文字；实际发送的原图由 todoForSend 一并读取。
     */
    async todoInstruction(input = {}, ctx = {}) {
      const args = argsOf(input);
      const id = shortId(args.id);
      const state = await readState();
      ensureEnabled(state);
      const row = state.todos.find((item) => item.id === id && allowed(item, ctx));
      if (!row) throw new Error('待办不存在或不属于当前项目');
      return instructionFor(row, args.note);
    },
    /** Load all original attachments before sending: never silently truncate a pictured task. */
    async todoForSend(input = {}, ctx = {}) {
      const args = argsOf(input);
      const state = await readState();
      ensureEnabled(state);
      const row = state.todos.find((item) => item.id === shortId(args.id) && allowed(item, ctx));
      if (!row) throw new Error('待办不存在或不属于当前项目');
      if (row.status === 'done') throw new Error('待办已完成，请先撤销完成再发送');
      if ((row.images?.length ?? 0) > 4)
        throw new Error('会话单次最多接收 4 张图片，请拆分待办后发送；原图片全部保留');
      const images = [];
      for (const image of row.images ?? []) {
        const found = await attachments.get(image.id, { full: true });
        if (!found) throw new Error('待办图片缺失，请先重新添加，未发送任何内容');
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(found.mime))
          throw new Error('会话仅支持 PNG/JPEG/WebP/GIF，请重新添加这张图片后发送');
        images.push({ data: found.data.toString('base64'), mimeType: found.mime });
      }
      const instruction = instructionFor(row, args.note);
      return {
        text: `${instruction.text}${images.length ? `\n本条消息已附上全部 ${images.length} 张原图。` : ''}`,
        images,
        id: row.id,
        expected: createHash('sha256').update(JSON.stringify(row)).digest('hex'),
      };
    },
    /** A late ACK must not overwrite an Agent's completion or a user's newer edit. */
    async markTodoSent(input, ctx = {}) {
      const args = argsOf(input);
      return storage.transaction((state) => {
        ensureEnabled(state);
        const row = state.todos.find((item) => item.id === shortId(args.id) && allowed(item, ctx));
        if (!row) return { status: null, updated: false };
        const same =
          createHash('sha256').update(JSON.stringify(row)).digest('hex') === args.expected;
        if (!same || row.status !== 'todo') return { status: row.status, updated: false };
        row.status = 'doing';
        row.updatedAt = now();
        invalidate(state, row.projectKey);
        return { status: row.status, updated: true };
      });
    },
    async trash(input = {}, ctx = {}) {
      const args = argsOf(input),
        state = await readState();
      // Return bounded metadata rather than potentially megabytes of deleted bodies.
      const rows = state.recovery
        .filter(
          (entry) =>
            entry.records.length && entry.records.every((item) => allowed(item.record, ctx))
        )
        .map((entry) => ({
          id: entry.id,
          deletedAt: entry.deletedAt,
          restoredAt: entry.restoredAt,
          count: entry.records.length,
          preview: (entry.records[0].record.content ?? entry.records[0].record.text).slice(0, 180),
          previews: entry.records
            .slice(0, 3)
            .map((item) => (item.record.content ?? item.record.text).slice(0, 120)),
          sources: entry.records.reduce((counts, item) => {
            counts[item.type] = (counts[item.type] ?? 0) + 1;
            return counts;
          }, {}),
        }));
      return page(rows, args);
    },
    async clear(input = {}, ctx = {}) {
      argsOf(input);
      return storage.transaction((state) => {
        ensureEnabled(state);
        invalidate(state, null);
        const rows = ['memories', 'logs', 'todos'].flatMap((type) =>
          state[type].filter((row) => allowed(row, ctx)).map((record) => ({ type, record }))
        );
        return removeRecords(state, rows, now(), 'clear-visible');
      });
    },
    async settings(input) {
      const args = argsOf(input);
      return storage.transaction((state) => {
        state.settings = parseSettings({ ...state.settings, ...args });
        invalidate(state, null);
        return state.settings;
      });
    },
    async status(_args = {}, ctx = {}) {
      const state = await readState();
      return {
        enabled: state.settings.enabled,
        settings: state.settings,
        project: projectOf(ctx),
        revision: state.revision,
        memories: state.memories.filter((row) => allowed(row, ctx)).length,
        todos: state.todos.filter((row) => allowed(row, ctx) && row.status !== 'done').length,
        doing: state.todos.filter((row) => allowed(row, ctx) && row.status === 'doing').length,
        logs: state.logs.filter((row) => allowed(row, ctx)).length,
        recoverable: state.recovery.filter(
          (row) =>
            row.restoredAt === null &&
            row.records.length &&
            row.records.every((item) => allowed(item.record, ctx))
        ).length,
        limits: LIMITS,
        search: 'BM25 keyword (Latin / CJK / #tag / [[link]]); no embeddings',
      };
    },
    /** What the next turn will actually start with, and what each block costs. */
    async context(_args = {}, ctx = {}) {
      const state = await readState();
      const report = contextSections(state, projectOf(ctx), '', now());
      const candidates = state.memories
        .filter((row) => allowed(row, ctx) && !looksSensitive(row.content))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || newest(a, b));
      return {
        enabled: report.enabled,
        budget: report.budget,
        header: report.header,
        total: report.total,
        text: report.text,
        sections: report.sections,
        memoryLimit: state.settings.maxMemories,
        memoryVisible: candidates.length,
        skipped: candidates
          .slice(state.settings.maxMemories, state.settings.maxMemories + 3)
          .map((row) => row.content.slice(0, 80)),
        mode: state.settings.mode,
      };
    },
    async checkpoint(kind, text, key, ctx) {
      const safe = content(text);
      const id = `auto-${createHash('sha256')
        .update(`${kind}\0${key}\0${projectOf(ctx)}`)
        .digest('hex')
        .slice(0, 32)}`;
      return storage.transaction((state) => {
        ensureEnabled(state);
        const existing = state.logs.find((row) => row.id === id && allowed(row, ctx));
        if (existing) {
          existing.text = safe;
          existing.updatedAt = now();
          return existing;
        }
        capacity(state, 'logs');
        const row = { ...base({}, ctx, 'auto'), id, text: safe, date: localDate(now()), kind };
        state.logs.push(row);
        return row;
      });
    },
    async applyAnalysis(analysis, ctx, expectedToken, sessionKey, flags) {
      // One transaction prevents a late model response from undoing a user clear/settings change.
      return storage.transaction((state) => {
        if (analysisToken(state, ctx) !== expectedToken || !state.settings.enabled)
          return { skipped: true };
        let learned = 0;
        if (flags.learn && (state.settings.autoLearn || flags.manual)) {
          for (const item of analysis.memories) {
            const text = content(item.content, 500);
            const ownership = owner(undefined, ctx);
            const existing = state.memories.find(
              (row) => row.projectKey === ownership.projectKey && similar(row.content, text)
            );
            if (existing) continue;
            capacity(state, 'memories');
            state.memories.push({
              ...base({}, ctx, 'auto'),
              content: text,
              kind: item.kind,
              pinned: false,
            });
            learned += 1;
          }
        }
        if (flags.summarize && state.settings.summarizeOnEnd && analysis.summary) {
          const id = `auto-${createHash('sha256')
            .update(`summary\0${sessionKey}\0${projectOf(ctx)}`)
            .digest('hex')
            .slice(0, 32)}`;
          const row = state.logs.find((item) => item.id === id);
          if (row) {
            row.text = content(analysis.summary);
            row.updatedAt = now();
          } else {
            capacity(state, 'logs');
            state.logs.push({
              ...base({}, ctx, 'auto'),
              id,
              date: localDate(now()),
              text: content(analysis.summary),
              kind: 'summary',
            });
          }
        }
        return { learned, summarized: flags.summarize && !!analysis.summary };
      });
    },
    async markdown(ctx = {}) {
      const state = await readState();
      const lines = ['# CodeKiln 记忆', '', `导出日期：${localDate(now())}`, '', '## 长期记忆'];
      for (const row of state.memories.filter((item) => allowed(item, ctx)).sort(newest))
        lines.push(
          `\n### ${row.kind} · ${row.scope}${row.pinned ? ' · 置顶' : ''}\n\n${row.content}`
        );
      lines.push('\n## 待办');
      for (const row of state.todos.filter((item) => allowed(item, ctx)))
        lines.push(
          `- [${row.status === 'done' ? 'x' : row.status === 'doing' ? '~' : ' '}] ${row.text}${row.images?.length ? ` · 图片 ${row.images.length} 张（本地）` : ''}`
        );
      lines.push('\n## 每日日志');
      for (const row of state.logs.filter((item) => allowed(item, ctx)).sort(newest))
        lines.push(`\n### ${row.date} · ${row.kind}\n\n${row.text}`);
      return lines.join('\n');
    },
  };
  return service;
}
