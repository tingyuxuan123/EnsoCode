// Debug mode: one run of the app with debugging ports open on 127.0.0.1 only. The ports have no
// authentication, so a run never opens one without saying so.
//
// Only what the host processes need of Kettu's `debug.ts` is carried over; the app's own switches
// and the ports file are main's business.

/** The only address a debugging port listens on. */
export const DEBUG_HOST = '127.0.0.1';

/** A debug run's ports, as the host processes report them to their parent. */
export interface DebugStatus {
  on: boolean;
  /**
   * The renderer's Chrome DevTools Protocol port: 'pipe' when it is a pipe, 'failed' when Chromium
   * never said it listens, as when the port is taken, and null until known.
   */
  cdp: number | 'pipe' | 'failed' | null;
  /** Each process's Node.js inspector, by process name: main, device-host and so on. */
  inspectors: { name: string; url: string }[];
  /** The ports file, or null outside a debug run. */
  file: string | null;
}

export const DEBUG_OFF: DebugStatus = { on: false, cdp: null, inspectors: [], file: null };
