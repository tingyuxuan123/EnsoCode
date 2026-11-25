/** Path-only, transient feedback; never a source of file access authority. */
export interface DesignActivityCall {
  id: string;
  toolName: 'read' | 'edit' | 'write';
  path: string;
  /** Absent while executing; false/true are successful/failed completion. */
  isError?: boolean;
}

const MAX_CALLS = 128;
const PATH_KEYS = ['path', 'file_path', 'filePath'] as const;
const HASHLINE_HEADER = /^\[(.+)#([0-9A-Fa-f]{4})\]$/;
const PATCH_HEADER = /^\*\*\* (Add File|Update File|Move to): (.+)$/;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0');

function isCall(value: unknown): value is DesignActivityCall {
  return (
    record(value) &&
    text(value.id, 512) &&
    text(value.path, 4096) &&
    (value.toolName === 'read' || value.toolName === 'edit' || value.toolName === 'write') &&
    (value.isError === undefined || typeof value.isError === 'boolean') &&
    Object.keys(value).every((key) => ['id', 'toolName', 'path', 'isError'].includes(key))
  );
}

export function isDesignActivityCalls(value: unknown): value is DesignActivityCall[] {
  return (
    Array.isArray(value) && value.length > 0 && value.length <= MAX_CALLS && value.every(isCall)
  );
}

/** Shared by streamed top-level arguments and actual codemode execution events. */
export function designActivityCalls(id: string, name: string, args: unknown): DesignActivityCall[] {
  if (!record(args)) return [];
  if (name === 'apply_patch') {
    if (typeof args.input !== 'string') return [];
    const calls: DesignActivityCall[] = [];
    const lines = args.input.split('\n');
    // The final line may still be a streamed, incomplete path.
    lines.pop();
    for (const line of lines) {
      const match = PATCH_HEADER.exec(line.replace(/\r$/, ''));
      if (!match) continue;
      const call = {
        id: `${id}#${calls.length}`,
        toolName: match[1] === 'Add File' ? 'write' : 'edit',
        path: match[2],
      };
      if (isCall(call)) calls.push(call);
      if (calls.length === MAX_CALLS) break;
    }
    return calls;
  }
  if (name !== 'read' && name !== 'edit' && name !== 'write') return [];
  let path: unknown = PATH_KEYS.map((key) => args[key]).find(
    (value) => typeof value === 'string' && value
  );
  if (!path && typeof args.input === 'string') {
    const first = args.input.split('\n').find((line) => line.trim());
    path = first ? HASHLINE_HEADER.exec(first.trim())?.[1] : undefined;
  }
  const call = { id, toolName: name, path };
  return isCall(call) ? [call] : [];
}
