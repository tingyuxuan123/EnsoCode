// Small helpers the pane needs and CodeKiln has no shared version of yet: a message and a code
// out of whatever a port request rejected with, and a clock that ticks while a recording runs.

import { useEffect, useState } from 'react';

/** A failed request's words: the port's own message, else whatever was thrown. */
export function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message === 'string' && message !== '') return message;
  return String(error);
}

/** The `PortErrorCode` a request rejected with, or null when it was not a port error. */
export function errorCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

/** Milliseconds since the epoch, refreshed each second while the caller is mounted. */
export function useSeconds(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** A count as minutes and seconds, such as 1:52. */
export function clockOf(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
