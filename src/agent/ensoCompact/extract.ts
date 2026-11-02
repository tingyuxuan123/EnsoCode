import { textOf, toolCallBlocks } from './serialize';
import type { AgentMessage, CompactFacts, FileOpsLike } from './types';

export type { AgentMessage, CompactFacts, FileOpsLike } from './types';

const PATH_RE = /(?:^|[\s`'"(])((?:src|app|lib|packages|test|tests)\/[\w./-]+\.\w+)/g;
const HARD_LINE_RE =
  /(?:^|\n)\s*(?:[-*]\s*)?(?:MUST|必须|不要|禁止|Do not|Don't|never|永远不要)\b[^\n]{2,200}/gi;
const GOAL_RE = /(?:Goal|目标)\s*[:：]\s*([^\n.]{3,160})/i;
const ERROR_RE = /\b(?:Error|TypeError|ReferenceError|FAILED|Exception)\b[:\s][^\n]{3,200}/i;
const HASHLINE_HEADER = /^\[(.+)#[0-9A-Fa-f]{4}\]/;
const MODIFY_TOOLS = new Set(['edit', 'write']);

function uniq(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim();
    if (!key) continue;
    const norm = key.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(key);
  }
  return out;
}

function pathsIn(text: string, args?: Record<string, unknown>): string[] {
  const found: string[] = [];
  for (const key of ['path', 'file', 'file_path', 'target']) {
    const value = args?.[key];
    if (typeof value === 'string' && /[./]/.test(value)) found.push(value);
  }
  PATH_RE.lastIndex = 0;
  let match: RegExpExecArray | null = PATH_RE.exec(text);
  while (match) {
    if (match[1]) found.push(match[1]);
    match = PATH_RE.exec(text);
  }
  return found;
}

/** edit/write 的目标路径；Hashline edit 无 path 时取 input 首行 `[path#TAG]`。 */
function targetPath(args: Record<string, unknown> | undefined): string | undefined {
  if (typeof args?.path === 'string') return args.path;
  if (typeof args?.input === 'string') return HASHLINE_HEADER.exec(args.input)?.[1];
  return undefined;
}

function appliedPatchPaths(message: AgentMessage): string[] {
  const value = message as { toolName?: unknown; details?: unknown };
  if (value.toolName !== 'apply_patch' || !value.details || typeof value.details !== 'object') {
    return [];
  }
  const details = value.details as Record<string, unknown>;
  if (details.kind !== 'apply_patch' || !Array.isArray(details.fileChanges)) return [];
  return details.fileChanges.flatMap((change) => {
    if (!change || typeof change !== 'object') return [];
    const path = (change as Record<string, unknown>).path;
    return typeof path === 'string' && path ? [path] : [];
  });
}

function todoItems(
  args: Record<string, unknown> | undefined
): Array<{ content: string; status: string }> {
  if (!Array.isArray(args?.todos)) return [];
  return args.todos.flatMap((t) => {
    const rec = t as { content?: unknown; status?: unknown };
    return typeof rec.content === 'string' && typeof rec.status === 'string'
      ? [{ content: rec.content, status: rec.status }]
      : [];
  });
}

export function extractCompactFacts(messages: AgentMessage[], fileOps?: FileOpsLike): CompactFacts {
  const constraints: string[] = [];
  const errors: string[] = [];
  const files: string[] = [];
  const readFiles: string[] = [...(fileOps?.read ?? [])];
  const modifiedFiles: string[] = [...(fileOps?.written ?? []), ...(fileOps?.edited ?? [])];
  const openLoops: string[] = [];
  let lastTodos: Array<{ content: string; status: string }> = [];
  let goal = '';
  let lastUser = '';

  for (const message of messages) {
    const { role, content } = message as { role: string; content?: unknown };
    const text = textOf(content);
    if (role === 'user') {
      // 自动唤醒沿用 SDK user 消息通路，但命令/代理输出不是用户决策或授权。
      if (/^\s*<(?:agent-notification|background-task-update)>/.test(text)) continue;
      lastUser = text.trim();
      const goalMatch = GOAL_RE.exec(text);
      if (goalMatch?.[1]) goal = goalMatch[1].trim();
      HARD_LINE_RE.lastIndex = 0;
      let hard = HARD_LINE_RE.exec(text);
      while (hard) {
        constraints.push(hard[0].trim().replace(/^[-*]\s*/, ''));
        hard = HARD_LINE_RE.exec(text);
      }
      files.push(...pathsIn(text));
      if (/\b(?:still|blocked|TODO|未完成|卡住)\b/i.test(text)) {
        openLoops.push(text.slice(0, 160));
      }
    } else if (role === 'assistant') {
      const err = ERROR_RE.exec(text);
      if (err) errors.push(err[0].trim());
      for (const call of toolCallBlocks(content)) {
        files.push(...pathsIn('', call.arguments));
        if (call.name === 'read' && typeof call.arguments?.path === 'string')
          readFiles.push(call.arguments.path);
        if (MODIFY_TOOLS.has(call.name)) {
          const target = targetPath(call.arguments);
          if (target) {
            modifiedFiles.push(target);
            files.push(target);
          }
        }
        if (call.name === 'todo') {
          const items = todoItems(call.arguments);
          if (items.length) lastTodos = items;
        }
      }
    } else if (role === 'toolResult') {
      const patched = appliedPatchPaths(message);
      modifiedFiles.push(...patched);
      files.push(...patched);
      if ((message as { isError?: boolean }).isError === true) {
        const line = text.trim().slice(0, 200);
        if (line) errors.push(line);
      }
    }
  }

  if (!goal && lastUser && lastUser.length >= 24) goal = lastUser.slice(0, 160);
  const modified = uniq(modifiedFiles);
  const modifiedSet = new Set(modified.map((f) => f.toLowerCase()));
  return {
    goal,
    constraints: uniq(constraints).slice(0, 12),
    errors: uniq(errors).slice(0, 8),
    files: uniq(files).slice(0, 24),
    readFiles: uniq(readFiles)
      .filter((f) => !modifiedSet.has(f.toLowerCase()))
      .slice(0, 40),
    modifiedFiles: modified.slice(0, 40),
    completedTodos: lastTodos.filter((t) => t.status === 'completed').map((t) => t.content),
    activeTodos: lastTodos.filter((t) => t.status !== 'completed').map((t) => t.content),
    openLoops: uniq(openLoops).slice(0, 8),
  };
}
