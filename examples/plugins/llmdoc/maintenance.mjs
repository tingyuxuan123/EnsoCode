import { lstat } from 'node:fs/promises';
import { join } from 'node:path';

/** @typedef {import('../../../types/enso-plugin').InvocationContext} InvocationContext */
/** @typedef {import('../../../types/enso-plugin').PluginMainApi} PluginMainApi */
/** @typedef {ReturnType<typeof import('./setup.mjs').createRuntimeSetup>} RuntimeSetup */

const prompts = new Map([
  ['init', '为当前项目初始化 llmdoc。'],
  ['update', '根据代码变更复核当前项目的 llmdoc。'],
  ['prune', '检查当前项目的 llmdoc 是否有可收敛或合并的内容。'],
]);

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function record(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} input */
function noArgs(input) {
  if (input !== undefined && (!record(input) || Object.keys(input).length > 0)) {
    throw new Error('此 llmdoc 操作不接受参数。');
  }
}

/** @param {InvocationContext} ctx */
function checkCancelled(ctx) {
  if (ctx?.signal?.aborted) throw new Error('llmdoc 调用已取消。');
}

/** @param {unknown} error @param {string} fallback */
function hint(error, fallback) {
  return (error instanceof Error ? error.message : fallback).slice(0, 320);
}

/** @param {string} root @returns {Promise<'missing' | 'present'>} */
async function workspaceState(root) {
  const stat = await lstat(join(root, 'llmdoc')).catch((error) => {
    if (record(error) && error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat) return 'missing';
  if (!stat.isDirectory()) throw new Error('llmdoc/ 必须是项目中的普通目录，不支持符号链接。');
  return 'present';
}

/**
 * Keep all writes to knowledge and Git behind the normal Code agent approval flow.
 * The only mutation from this adapter is a user-gesture scoped write to an empty draft.
 * @param {PluginMainApi} enso
 * @param {{gitRoot: (ctx: InvocationContext) => Promise<string>, executable: (config: unknown, root: string) => Promise<{node: string, entry: string}>, resolveGitExecutable: (config: unknown, root: string) => Promise<string>, setup?: RuntimeSetup}} deps
 */
export function registerMaintenance(enso, deps) {
  /** @param {string} root */
  const configFor = (root) => (deps.setup ? deps.setup.resolveConfig(root) : enso.config.get());

  /** @param {string} root */
  const runtime = async (root) => {
    const config = await configFor(root);
    const { node, entry } = await deps.executable(config, root);
    const gitExecutable = await deps.resolveGitExecutable(config, root);
    return { nodeExecutable: node, cliEntry: entry, gitExecutable };
  };

  enso.renderer.handle('inspect', async (input, ctx) => {
    noArgs(input);
    checkCancelled(ctx);
    const root = await deps.gitRoot(ctx);
    const state = await workspaceState(root);
    const config = await configFor(root);
    const [[cli, git], setup] = await Promise.all([
      Promise.allSettled([deps.executable(config, root), deps.resolveGitExecutable(config, root)]),
      deps.setup?.inspect(root),
    ]);
    checkCancelled(ctx);
    return {
      state,
      configured: cli.status === 'fulfilled',
      gitConfigured: git.status === 'fulfilled',
      ...(setup ? { setup } : {}),
      ...(cli.status === 'rejected'
        ? { configurationError: hint(cli.reason, '请检查扩展配置中的 Node 和 llmdoc CLI。') }
        : {}),
      ...(git.status === 'rejected'
        ? { gitConfigurationError: hint(git.reason, '请检查扩展配置中的 Git。') }
        : {}),
    };
  });

  const setup = deps.setup;
  if (setup) {
    // Installation is a sidebar action, not a model tool or an inspection side effect.
    enso.renderer.handle('install_cli', async (input, ctx) => {
      noArgs(input);
      checkCancelled(ctx);
      const root = await deps.gitRoot(ctx);
      // The host verifies the focused view's real gesture. Discard the read result;
      // installation does not need, transmit, or modify any draft content.
      await enso.composer.readDraft();
      checkCancelled(ctx);
      return setup.install(root, ctx.signal);
    });
  }

  enso.renderer.handle('prepare_workflow', async (input, ctx) => {
    if (
      !record(input) ||
      Object.keys(input).length !== 1 ||
      typeof input.action !== 'string' ||
      !prompts.has(input.action)
    ) {
      throw new Error('llmdoc 工作流参数无效。');
    }
    const action = input.action;
    checkCancelled(ctx);
    const root = await deps.gitRoot(ctx);
    const state = await workspaceState(root);
    if (action === 'init' && state === 'present') {
      throw new Error('项目已有 llmdoc/；请先校验或复核，不要重复初始化。');
    }
    if (action !== 'init' && state === 'missing') {
      throw new Error('项目没有 llmdoc/；请先初始化。');
    }
    await runtime(root);
    checkCancelled(ctx);
    const draft = await enso.composer.readDraft();
    if (draft.text.trim() || draft.hasReferences) {
      throw new Error('请先发送或清空现有草稿，再准备独立的 llmdoc 请求。');
    }
    checkCancelled(ctx);
    await enso.composer.insertText({
      text: `请使用 llmdoc-maintenance 技能准备 ${action} 工作流：${prompts.get(action)}先查证据并给出变更预览，在我确认前不写文件，也不创建 Git 提交。`,
      expect: { generation: draft.generation, rev: draft.rev },
    });
    return { prepared: true };
  });

  enso.tools.register('runtime', async (args, ctx) => {
    noArgs(args);
    checkCancelled(ctx);
    const projectRoot = await deps.gitRoot(ctx);
    const state = await workspaceState(projectRoot);
    const config = await runtime(projectRoot);
    checkCancelled(ctx);
    return { content: JSON.stringify({ state, projectRoot, ...config }) };
  });
}
