import type { DesignToolRequestEvent } from '@shared/types/design';
import {
  getCanvasController,
  onCanvasController,
  setPendingDesignPath,
} from '../vetta/src/canvas/design-runtime';
import { CANVAS_TAB_ID } from '../vetta/src/tab-ids';
import { findVetdFiles } from '../vetta/src/vetd/discover';
import type { PluginContext } from './types';

const WAIT_MS = 60_000;
// Retain create's exact target after an open failure; retrying status must not
// silently settle on the older design in the same workspace.
const createdTargets = new Map<string, string>();
let viewingCwd: string | null = null;
export function setDesignViewingCwd(cwd: string | null): void {
  viewingCwd = cwd;
}
export function isDesignViewingCwd(cwd: string): boolean {
  return viewingCwd === cwd;
}
export class DesignCanvasUnavailable extends Error {
  constructor(
    message: string,
    readonly vetdPath?: string
  ) {
    super(message);
  }
}
function assertViewing(cwd: string): void {
  if (!isDesignViewingCwd(cwd))
    throw new DesignCanvasUnavailable(
      'The design canvas is viewing another project (or switching sessions). Ask the user to switch back to this session, then retry. No canvas was switched.'
    );
}

// Only one tool may select/use the singleton at a time. Queue waits are bounded;
// cancelling a waiter removes it, cancelling an owner releases in dispatch's finally.
let leased = false;
const waiters = new Set<() => void>();
export function acquireDesignCanvas(signal: AbortSignal): Promise<() => void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      waiters.delete(take);
      signal.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      cleanup();
      reject(signal.reason);
    };
    const take = () => {
      if (leased) return;
      cleanup();
      leased = true;
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        leased = false;
        waiters.values().next().value?.();
      });
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new DesignCanvasUnavailable('The design canvas is busy. Retry this tool shortly.'));
    }, WAIT_MS);
    signal.addEventListener('abort', cancel, { once: true });
    waiters.add(take);
    take();
  });
}

async function openCanvas(
  cwd: string,
  path: string,
  ctx: PluginContext,
  signal: AbortSignal
): Promise<void> {
  signal.throwIfAborted();
  assertViewing(cwd);
  if (!path.startsWith(`${cwd.replace(/\/+$/, '')}/`))
    throw new DesignCanvasUnavailable('The requested design is outside this session workspace.');
  if (getCanvasController(cwd)?.session.vetdPath === path) return;
  setPendingDesignPath(path, cwd);
  ctx.ui.openActivityTab(CANVAS_TAB_ID, { cwd, width: 'max' });
  await new Promise<void>((resolve, reject) => {
    let unsubscribe = () => {};
    let done = false;
    const finish = (error?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe();
      signal.removeEventListener('abort', cancel);
      if (error) reject(error);
      else resolve();
    };
    const cancel = () => finish(signal.reason);
    const timer = setTimeout(
      () =>
        finish(
          new DesignCanvasUnavailable(
            `The design canvas did not open ${path} in time. Retry after the canvas is ready.`,
            path
          )
        ),
      WAIT_MS
    );
    signal.addEventListener('abort', cancel, { once: true });
    unsubscribe = onCanvasController(() => {
      if (!isDesignViewingCwd(cwd)) {
        finish(
          new DesignCanvasUnavailable(
            'The user switched to another project. Switch back to this session before retrying.',
            path
          )
        );
      } else if (getCanvasController(cwd)?.session.vetdPath === path) finish();
    });
    // onCanvasController immediately replays, including an already-ready controller.
    if (done) unsubscribe();
    if (signal.aborted) cancel();
  });
}

const renderedTools = new Set(['vetd_screenshot', 'vetd_direction', 'vetd_assets', 'vetd_export']);
export function usesDesignCanvas(request: DesignToolRequestEvent): boolean {
  return (
    renderedTools.has(request.tool) ||
    request.tool === 'vetd_create' ||
    (request.tool === 'vetd_status' && isDesignViewingCwd(request.session.cwd))
  );
}
export async function prepareDesignCanvas(
  request: DesignToolRequestEvent,
  ctx: PluginContext,
  signal: AbortSignal
): Promise<void> {
  const cwd = request.session.cwd;
  if (request.tool === 'vetd_create') {
    // Reject BEFORE scaffolding: a background create must not steal the foreground dock.
    assertViewing(cwd);
    return;
  }
  if (!renderedTools.has(request.tool) && request.tool !== 'vetd_status') return;
  if (request.tool === 'vetd_status' && !isDesignViewingCwd(cwd)) return;
  assertViewing(cwd);
  const created = createdTargets.get(cwd);
  if (created) {
    await openCanvas(cwd, created, ctx, signal);
    createdTargets.delete(cwd);
    return;
  }
  if (getCanvasController(cwd)) return;
  const files = await findVetdFiles(ctx.fs, cwd);
  signal.throwIfAborted();
  if (!files.length) {
    if (request.tool === 'vetd_status') return;
    throw new DesignCanvasUnavailable(
      'No design was found in this session workspace. Open a design here, then retry.'
    );
  }
  const remembered = localStorage.getItem(`vetta-ui-design:file:${cwd}`);
  await openCanvas(cwd, files.find((path) => path === remembered) ?? files[0], ctx, signal);
}

export async function finishDesignCreate(
  request: DesignToolRequestEvent,
  result: unknown,
  ctx: PluginContext,
  signal: AbortSignal
): Promise<unknown> {
  if (
    request.tool !== 'vetd_create' ||
    !result ||
    typeof result !== 'object' ||
    !('ok' in result) ||
    result.ok !== true ||
    !('vetdPath' in result) ||
    typeof result.vetdPath !== 'string'
  )
    return result;
  createdTargets.set(request.session.cwd, result.vetdPath);
  try {
    await openCanvas(request.session.cwd, result.vetdPath, ctx, signal);
    createdTargets.delete(request.session.cwd);
    return result;
  } catch (error) {
    signal.throwIfAborted();
    return {
      ok: false,
      created: true,
      retryable: true,
      vetdPath: result.vetdPath,
      error: `${error instanceof Error ? error.message : String(error)} The design already exists at ${result.vetdPath}; do not repeat vetd_create. Retry vetd_status or vetd_screenshot after switching back to this session.`,
    };
  }
}
