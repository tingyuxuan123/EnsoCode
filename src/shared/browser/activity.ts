/** Passive CDP bookkeeping only: no URLs, bodies, cookies or credentials retained. */
export class BrowserActivity {
  private readonly requests = new Map<string, number>();

  observe(method: string, raw: unknown, now = Date.now()): void {
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('requestId' in raw) ||
      typeof raw.requestId !== 'string'
    )
      return;
    if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
      this.requests.delete(raw.requestId);
    } else if (method === 'Network.requestWillBeSent') {
      if ('type' in raw && (raw.type === 'WebSocket' || raw.type === 'EventSource')) return;
      if (this.requests.size >= 1000) this.requests.delete(this.requests.keys().next().value!);
      this.requests.set(raw.requestId, now);
    }
  }

  pendingSince(since: number, now = Date.now()): number {
    let count = 0;
    for (const [id, started] of this.requests) {
      if (now - started > 30000) this.requests.delete(id);
      else if (started >= since) count++;
    }
    return count;
  }

  clear(): void {
    this.requests.clear();
  }
}
