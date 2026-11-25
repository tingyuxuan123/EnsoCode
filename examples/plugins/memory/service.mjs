import { createHash, randomUUID } from 'node:crypto';
import {
  boolean,
  content,
  DAILY_KINDS,
  enumValue,
  integer,
  isObject,
  KINDS,
  LIMITS,
  localDate,
  newest,
  parseSettings,
  search,
  similar,
  validDate,
  visible,
} from './domain.mjs';
import { createStorage } from './storage.mjs';

const shortId = (value) => {
  if (typeof value !== 'string' || !/^[a-z0-9-]{1,80}$/.test(value))
    throw new Error('记录 ID 无效');
  return value;
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

export function createMemoryService(directory, { now = Date.now } = {}) {
  const storage = createStorage(directory);
  const readState = () => storage.load();
  const base = (args, ctx, source) => ({
    id: randomUUID(),
    ...owner(args.scope, ctx),
    source,
    createdAt: now(),
    updatedAt: now(),
  });
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
      if (date) rows = rows.filter((row) => row.date === date);
      if (id) rows = rows.filter((row) => row.id === id);
      if (kind) rows = rows.filter((row) => row.kind === kind);
      if (scope) rows = rows.filter((row) => row.scope === scope);
      if (done !== undefined && target === 'scratchpad')
        rows = rows.filter((row) => row.done === done);
      return page(
        rows.sort((a, b) => Number(b.pinned) - Number(a.pinned) || newest(a, b)),
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
        ['add', 'done', 'undo', 'remove', 'clear_done', 'list', 'edit'],
        'list'
      );
      if (action === 'list') return service.read({ ...args, target: 'scratchpad' }, ctx);
      return storage.transaction((state) => {
        ensureEnabled(state);
        if (action === 'add') {
          capacity(state, 'todos');
          const row = { ...base(args, ctx, 'user'), text: content(args.text), done: false };
          state.todos.push(row);
          invalidate(state, row.projectKey);
          return { added: row };
        }
        if (action === 'clear_done')
          return removeRecords(
            state,
            state.todos
              .filter((row) => allowed(row, ctx) && row.done)
              .map((record) => ({ type: 'todos', record })),
            now(),
            'clear-done'
          );
        const row = state.todos.find((item) => item.id === shortId(args.id) && allowed(item, ctx));
        if (!row) throw new Error('待办不存在或不属于当前项目');
        if (action === 'remove')
          return removeRecords(state, [{ type: 'todos', record: row }], now(), 'delete');
        if (action === 'edit') row.text = content(args.text);
        else row.done = action === 'done';
        row.updatedAt = now();
        invalidate(state, row.projectKey);
        return { item: row };
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
        todos: state.todos.filter((row) => allowed(row, ctx) && !row.done).length,
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
        lines.push(`- [${row.done ? 'x' : ' '}] ${row.text}`);
      lines.push('\n## 每日日志');
      for (const row of state.logs.filter((item) => allowed(item, ctx)).sort(newest))
        lines.push(`\n### ${row.date} · ${row.kind}\n\n${row.text}`);
      return lines.join('\n');
    },
  };
  return service;
}
