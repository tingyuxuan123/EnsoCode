import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

const KINDS = ['architecture', 'guide', 'reference'];
const MAX_DOCUMENTS = 3;
const MAX_BODY = 40_000;
const MAX_DESCRIPTION = 320;
const MAX_PATHS = 40;
const MAX_LEDGER = 4 * 1024 * 1024;
const MAX_REVIEWS = 50;
const MAX_ENTRY_BYTES = 512 * 1024;
const CONTROL = /[\p{Cc}\p{Cf}]/u;
const DOC_ID = /^llmdoc\/(?:[a-z0-9][a-z0-9-]*\/)?[a-z0-9][a-z0-9.-]*\.mdx$/;
// Control characters stay excluded via a property escape so the intent survives linting.
const SOURCE_PATH = /^(?!\/)(?!.*\/\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[^\p{Cc}:*?"<>|\\]+$/u;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const record = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value) => typeof value === 'string';

/** @param {string} value */
const stripFence = (value) =>
  value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

/** @param {string} value */
function description(value) {
  if (!text(value)) throw new Error('文档缺少 description。');
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_DESCRIPTION || CONTROL.test(trimmed))
    throw new Error('description 必须是 1–320 字符的单行文本。');
  return trimmed;
}

/** @param {unknown} value */
function documentId(value) {
  if (!text(value) || value.length > 240 || !DOC_ID.test(value) || CONTROL.test(value))
    throw new Error('文档路径必须是 llmdoc/<主题>/<名称>.mdx（最多一层主题，小写）。');
  const name = value.slice('llmdoc/'.length).split('/').pop() ?? '';
  if (name === 'index.mdx' || name === 'meta.json')
    throw new Error('V3 文档不能使用 index.mdx 或 meta.json 作为文件名。');
  return value;
}

/** @param {unknown} value */
function sourcePath(value) {
  if (
    !text(value) ||
    value.length > 240 ||
    value.startsWith('-') ||
    CONTROL.test(value) ||
    !SOURCE_PATH.test(value) ||
    value.split('/').some((part) => !part || part !== part.trim() || part.endsWith('.'))
  )
    throw new Error('源码路径必须是项目内的相对文件路径。');
  return value;
}

/**
 * Parse the strict proposal the read-only agent returns. Nothing is trusted: paths, kinds,
 * sizes and control characters are all re-checked here before any file is written.
 * @param {unknown} raw
 */
export function parseProposal(raw) {
  if (!text(raw)) throw new Error('自动维护没有返回文本。');
  if (raw.length > MAX_ENTRY_BYTES) throw new Error('自动维护返回内容过大。');
  if (raw.trim() === 'NONE') return { documents: [] };
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(stripFence(raw));
  } catch {
    throw new Error('自动维护未返回约定的 JSON。');
  }
  if (!record(parsed) || !Array.isArray(parsed.documents)) throw new Error('提案缺少 documents。');
  if (parsed.documents.length > MAX_DOCUMENTS)
    throw new Error(`一次最多提交 ${MAX_DOCUMENTS} 篇文档。`);
  const seen = new Set();
  const documents = parsed.documents.map((row) => {
    if (!record(row)) throw new Error('文档条目格式无效。');
    const path = documentId(row.path);
    if (seen.has(path)) throw new Error('同一提案不能重复声明同一文档。');
    seen.add(path);
    if (!text(row.kind) || !KINDS.includes(row.kind))
      throw new Error('kind 必须是 architecture/guide/reference。');
    if (!text(row.body) || !row.body.trim() || row.body.length > MAX_BODY)
      throw new Error(`正文必须是 1–${MAX_BODY} 字符。`);
    const codePaths = row.codePaths === undefined ? [] : row.codePaths;
    if (!Array.isArray(codePaths) || codePaths.length > MAX_PATHS)
      throw new Error(`codePaths 最多 ${MAX_PATHS} 条。`);
    return {
      path,
      kind: row.kind,
      description: description(row.description),
      codePaths: Array.from(new Set(codePaths.map(sourcePath))),
      body: row.body,
    };
  });
  return { documents };
}

/** @param {string} value */
const yaml = (value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** @param {{kind: string, description: string, codePaths: string[]}} doc */
function frontMatter(doc) {
  const lines = ['---', `description: ${yaml(doc.description)}`, `kind: ${doc.kind}`];
  if (doc.codePaths.length) {
    lines.push('code:', '  paths:');
    for (const path of doc.codePaths) lines.push(`    - ${path}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

/** @param {{body: string}} doc */
const body = (doc) => `${doc.body.replace(/\r\n/g, '\n').trimEnd()}\n`;

/** @param {{kind: string, description: string, codePaths: string[], body: string}} doc */
export function renderDocument(doc) {
  return `${frontMatter(doc)}${body(doc)}`;
}

/**
 * Update only what the proposal owns: new entries, changed front matter and appended prose.
 * Existing prose is kept so an automatic pass can never delete a hand-written section.
 * @param {string} current @param {{kind: string, description: string, codePaths: string[], body: string}} doc
 */
export function mergeDocument(current, doc) {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(current);
  // A registered document without front matter still owns its prose: keep it verbatim.
  const rest = match ? current.slice(match[0].length) : current;
  const declared = new Set(
    match ? Array.from(match[0].matchAll(/^\s+- (.+)$/gm), (found) => found[1].trim()) : []
  );
  const codePaths = Array.from(new Set([...declared, ...doc.codePaths])).sort();
  const incoming = body(doc).trimEnd();
  const prose = rest.trimEnd();
  return `${frontMatter({ ...doc, codePaths })}${prose}${
    prose.includes(incoming) ? '' : `\n\n${incoming}`
  }\n`;
}

/** @param {Record<string, unknown>} meta @param {{path: string}[]} documents */
export function renderLedger(meta, documents) {
  const next = JSON.parse(JSON.stringify(meta));
  next.documents = record(next.documents) ? next.documents : {};
  for (const doc of documents) {
    const key = doc.path.slice('llmdoc/'.length);
    next.documents[key] = record(next.documents[key])
      ? next.documents[key]
      : { validatedRevision: null };
  }
  const count = Object.keys(next.documents).length;
  next.convergence = record(next.convergence) ? next.convergence : {};
  next.convergence.documentCount = count;
  return next;
}

/** @param {unknown} value */
function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Private review ledger in the plugin data directory. It is the only place the prior bytes of
 * an automatically written file are kept, so a restore can be byte-exact without Git.
 * @param {string} directory
 */
async function reviews(directory) {
  const file = join(directory, 'reviews.json');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  /** @param {unknown} value */
  const valid = (value) =>
    record(value) && Array.isArray(value.entries)
      ? { ...value, entries: value.entries }
      : { entries: [] };
  const read = async () => {
    const handle = await open(file, 'r').catch(() => null);
    if (!handle) return { entries: [] };
    try {
      return valid(JSON.parse(await handle.readFile('utf8')));
    } finally {
      await handle.close();
    }
  };
  return {
    read,
    /** @param {(state: {entries: Record<string, unknown>[]}) => unknown} change */
    async write(change) {
      const state = await read();
      const result = await change(state);
      state.entries = state.entries.slice(-MAX_REVIEWS);
      const temporary = join(directory, `.reviews-${randomUUID()}.tmp`);
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, file).catch(async (error) => {
        await rm(temporary, { force: true });
        throw error;
      });
      return result;
    },
  };
}

/** @param {unknown} value */
function sessionId(value) {
  return text(value) && value.length > 0 && value.length <= 200 && !CONTROL.test(value)
    ? value
    : null;
}

/**
 * Background maintenance for a local Git project with an existing llmdoc/.
 *
 * One read-only agent run per project turn proposes at most three documents. The plugin then
 * re-validates every path, appends only new prose, registers the documents in meta.json, and
 * keeps the exact prior bytes for review and rollback. It never commits, never advances the
 * global baseline and never deletes a document.
 *
 * @param {import('../../../types/enso-plugin').PluginMainApi} enso
 * @param {{projectRoot: (ctx: unknown) => string | null, timeoutMs?: number}} deps
 */
export function createAutomation(enso, deps) {
  const running = new Map();
  const store = () => reviews(enso.dataDir);
  const timeoutMs = deps.timeoutMs ?? 120_000;

  /** @param {(state: {entries: Record<string, unknown>[]}) => unknown} change */
  async function ledgerChange(change) {
    const ledger = await store();
    return ledger.write(change);
  }

  /** @param {unknown} ctx @returns {{root: string, sessionId: string} | null} */
  function usable(ctx) {
    const value = record(ctx) ? ctx : {};
    if (value.agent || value.caller) return null;
    const session = sessionId(value.sessionId);
    const root = deps.projectRoot(value);
    return session && text(root) ? { root, sessionId: session } : null;
  }

  /** @param {string} root */
  async function readLedger(root) {
    const raw = await enso.fs.readText('llmdoc/meta.json');
    /** @type {unknown} */
    const meta = JSON.parse(raw);
    if (!record(meta) || meta.schema !== 'llmdoc.meta/v3')
      throw new Error('llmdoc/meta.json 不是 V3 台账。');
    return { meta, raw };
  }

  /** @param {string} root */
  async function existingDocs(root) {
    /** @type {{path: string, text: string}[]} */
    const docs = [];
    const ledger = await readLedger(root);
    for (const key of Object.keys(record(ledger.meta.documents) ? ledger.meta.documents : {})) {
      if (!DOC_ID.test(`llmdoc/${key}`)) continue;
      const content = await enso.fs.readText(`llmdoc/${key}`).catch(() => null);
      if (content !== null) docs.push({ path: `llmdoc/${key}`, text: content.slice(0, 4000) });
      if (docs.length >= 40) break;
    }
    return { ledger, docs };
  }

  /**
   * @param {{root: string, sessionId: string}} target
   * @param {{turn: string}} turn
   */
  async function propose(target, turn) {
    const { ledger, docs } = await existingDocs(target.root);
    const prompt = JSON.stringify({
      task: 'auto-maintain',
      instruction:
        '只根据本仓库源码，为缺少知识文档的模块补充最多 3 篇 llmdoc 文档。不要修改已有正文，不要编造证据。',
      turn: turn.turn.slice(0, 6000),
      existing: docs,
    });
    const result = await enso.agent.run({
      context: 'none',
      timeoutMs,
      systemPrompt:
        '你是 llmdoc 知识维护器。用只读工具调查当前仓库后，只输出 JSON：{"documents":[{"path":"llmdoc/<主题>/<名称>.mdx","kind":"architecture|guide|reference","description":"<=320字单行","codePaths":["仓库相对路径"],"body":"Markdown，<=40000字符"}]}。没有需要补充的内容输出 NONE。path 只能一层主题、小写、不能是 index.mdx；每篇必须至少一个真实存在的 codePaths；正文只写源码能证明的契约与边界，禁止推测、密钥、聊天内容或任务进度；不要写 front matter（由插件生成）。',
      prompt,
    });
    return { proposal: parseProposal(result.text), ledger };
  }

  /**
   * @param {string} root
   * @param {{documents: {path: string, kind: string, description: string, codePaths: string[], body: string}[]}} proposal
   * @param {{meta: Record<string, unknown>, raw: string}} ledger
   * @param {string} session
   */
  async function apply(root, proposal, ledger, session) {
    /** @type {{path: string, before: string | null, after: string}[]} */
    const files = [];
    for (const doc of proposal.documents) {
      const before = await enso.fs.readText(doc.path).catch(() => null);
      files.push({
        path: doc.path,
        before,
        after: before ? mergeDocument(before, doc) : renderDocument(doc),
      });
    }
    const meta = renderLedger(ledger.meta, proposal.documents);
    const after = `${JSON.stringify(meta, null, 2)}\n`;
    if (after.length > MAX_LEDGER) throw new Error('台账过大，已跳过自动维护。');
    files.push({ path: 'llmdoc/meta.json', before: ledger.raw, after });
    const entry = {
      id: randomUUID(),
      at: new Date().toISOString(),
      session,
      status: 'applied',
      summary: proposal.documents.map((doc) => `${doc.path}（${doc.kind}）`).join('、'),
      proposal,
      files: files.map((file) => ({
        path: file.path,
        before: file.before,
        beforeHash: file.before === null ? null : hash(file.before),
        after: file.after,
        afterHash: hash(file.after),
      })),
    };
    // Record the intent first: if a write fails midway the prior bytes are already recoverable.
    await ledgerChange((state) => {
      state.entries.push({ ...entry, status: 'pending' });
    });
    try {
      for (const file of files) await enso.fs.writeText(file.path, file.after);
    } catch (error) {
      await ledgerChange((state) => {
        const row = state.entries.find((item) => record(item) && item.id === entry.id);
        if (row) row.status = 'failed';
      });
      throw error;
    }
    await ledgerChange((state) => {
      const row = state.entries.find((item) => record(item) && item.id === entry.id);
      if (row) row.status = 'applied';
    });
    return entry;
  }

  return {
    /**
     * @param {unknown} data
     * @param {unknown} ctx
     */
    async end(data, ctx) {
      const target = usable(ctx);
      if (!target) return { skipped: true };
      const config = await enso.config.get().catch(() => ({}));
      if (config?.autoMaintain !== true) return { skipped: true };
      if (running.has(target.root)) return { skipped: true, reason: '自动维护仍在进行' };
      const turn = record(data) && text(data.text) ? data.text : '';
      if (!turn.trim()) return { skipped: true };
      const operation = (async () => {
        try {
          const { proposal, ledger } = await propose(target, { turn });
          if (!proposal.documents.length) return { skipped: true, reason: '没有需要补充的知识' };
          const entry = await apply(target.root, proposal, ledger, target.sessionId);
          await enso.ui.view.emit('reviews', { entries: 1 }).catch(() => null);
          await enso.ui
            .notify('知识地图已自动更新', `${entry.summary}。可在侧栏审阅或回退；未创建 Git 提交。`)
            .catch(() => null);
          return { applied: proposal.documents.length, id: entry.id };
        } catch (error) {
          await enso.ui
            .notify('知识地图自动维护未完成', String(error?.message ?? error).slice(0, 300))
            .catch(() => null);
          return { skipped: true, error: String(error?.message ?? error) };
        }
      })();
      running.set(target.root, operation);
      try {
        return await operation;
      } finally {
        if (running.get(target.root) === operation) running.delete(target.root);
      }
    },

    /** @param {unknown} input */
    async list(input) {
      if (input !== undefined && (!record(input) || Object.keys(input).length > 0))
        throw new Error('此操作不接受参数。');
      const state = await (await store()).read();
      return {
        entries: state.entries
          .filter(record)
          .map((entry) => ({
            id: entry.id,
            at: entry.at,
            status: entry.status,
            summary: entry.summary,
            files: Array.isArray(entry.files)
              ? entry.files.map((file) =>
                  record(file) ? { path: file.path, created: file.before === null } : null
                )
              : [],
          }))
          .reverse(),
      };
    },

    /** @param {unknown} id */
    async restore(id) {
      if (!text(id) || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('审阅条目 id 无效。');
      const state = await (await store()).read();
      const entry = state.entries.find((row) => record(row) && row.id === id);
      if (!record(entry)) throw new Error('没有这条自动维护记录。');
      if (entry.status === 'restored') throw new Error('这条记录已经恢复过。');
      if (!Array.isArray(entry.files)) throw new Error('这条记录没有可恢复的文件。');
      // Refuse to clobber a file changed after the automatic write.
      for (const file of entry.files) {
        if (!record(file) || !text(file.path) || !text(file.afterHash)) continue;
        const current = await enso.fs.readText(file.path).catch(() => null);
        if ((current === null ? null : hash(current)) !== file.afterHash)
          throw new Error(`${file.path} 已被修改，已拒绝回退以免覆盖你的编辑。`);
      }
      for (const file of [...entry.files].reverse()) {
        if (!record(file) || !text(file.path)) continue;
        if (file.before === null) {
          // The host API has no delete: leave a valid, clearly archived stub and unregister it.
          await enso.fs.writeText(
            file.path,
            `---\ndescription: "自动维护已回退的文档，可安全删除"\nkind: reference\n---\n\n# 已回退\n\n这篇文档由知识地图自动维护创建，随后被回退。宿主 API 不能删除文件，请手动删除。\n`
          );
        } else if (text(file.before)) {
          await enso.fs.writeText(file.path, file.before);
        }
      }
      await ledgerChange((next) => {
        const row = next.entries.find((item) => record(item) && item.id === id);
        if (row) {
          row.status = 'restored';
          row.restoredAt = new Date().toISOString();
        }
      });
      return {
        restored: true,
        id,
        needsManualDelete: entry.files.some((file) => record(file) && file.before === null),
      };
    },
  };
}
