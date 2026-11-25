import { type DesignActivityCall, designActivityCalls } from '@shared/design/toolActivity';
import { APPLY_PATCH_LIMITS } from './applyPatch/limits';
import { parseApplyPatch, requireApplyPatchInput } from './applyPatch/parser';

/** Executing patches have complete arguments: use the same grammar as the actual tool. */
export function executingDesignActivityCalls(
  id: string,
  name: string,
  args: unknown
): DesignActivityCall[] {
  if (name !== 'apply_patch') return designActivityCalls(id, name, args);
  try {
    const calls: DesignActivityCall[] = [];
    const input = requireApplyPatchInput(args);
    if (Buffer.byteLength(input, 'utf8') > APPLY_PATCH_LIMITS.patchBytes) return [];
    for (const operation of parseApplyPatch(input)) {
      if (operation.type === 'delete') continue;
      for (const path of operation.type === 'update' && operation.movePath
        ? [operation.path, operation.movePath]
        : [operation.path]) {
        calls.push(
          ...designActivityCalls(
            `${id}#${calls.length}`,
            operation.type === 'add' ? 'write' : 'edit',
            { path }
          )
        );
        if (calls.length === 128) return calls;
      }
    }
    return calls;
  } catch {
    // Telemetry must not replace the real tool's validation/error handling.
    return [];
  }
}
