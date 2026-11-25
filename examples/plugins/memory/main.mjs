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
    read: (args, ctx) => service.read({ ...args, limit: Math.min(args.limit ?? 6, 6) }, ctx),
    search: (args, ctx) => service.find({ ...args, limit: Math.min(args.limit ?? 6, 6) }, ctx),
    trash: service.trash,
    save: (args, ctx) => service.write(args, ctx, 'user'),
    forget: service.forget,
    restore: service.restore,
    scratchpad: service.scratchpad,
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
      if (['save', 'forget', 'restore', 'scratchpad', 'settings', 'clear'].includes(name))
        await changed();
      return result;
    });
  }
  enso.commands.register('open', () => enso.ui.view.open('memory'));
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
