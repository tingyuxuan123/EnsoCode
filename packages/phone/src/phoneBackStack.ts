/** One same-document history guard for the currently visible phone layers.
 * No message, credential, path, or URL is written into browser history. */
export interface PhoneHistoryPort {
  state(): unknown;
  push(state: Record<string, unknown>): void;
  back(): void;
  listen(listener: (state: unknown) => void): () => void;
  defer(callback: () => void): void;
}

const MARKER = '__collabraPhoneBack';
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const guarded = (state: unknown) => record(state) && state[MARKER] === 1;

export function createPhoneBackStack(port: PhoneHistoryPort) {
  const layers = new Map<symbol, { close(): void; rank: number }>();
  let armed = guarded(port.state());
  let consuming = false;
  let deferred = false;

  const arm = () => {
    if (armed || consuming || layers.size === 0) return;
    const state = port.state();
    try {
      if (!guarded(state)) port.push({ ...(record(state) ? state : {}), [MARKER]: 1 });
      armed = true;
    } catch {
      // A browser denying History API must not break explicit in-app navigation.
      armed = false;
    }
  };

  const settle = () => {
    deferred = false;
    if (consuming) return;
    if (layers.size > 0) {
      arm();
    } else if (armed) {
      armed = false;
      // Never consume a different app's entry after somebody replaced our marker.
      if (!guarded(port.state())) return;
      consuming = true;
      port.back();
    }
  };

  port.listen((state) => {
    if (consuming) {
      consuming = false;
      armed = false;
      arm();
      return;
    }
    if (guarded(state)) {
      // Forward is not an instruction to reopen a stale dialog or submit anything.
      armed = layers.size > 0;
      if (!armed) {
        consuming = true;
        // Leave the marker intact so Forward cannot turn it into another empty base entry.
        port.back();
      }
      return;
    }
    if (!armed) return;
    armed = false;
    let top: { id: symbol; close(): void; rank: number } | undefined;
    for (const [id, layer] of layers) {
      // Rank handles child effects mounting before their parent; ties use latest-opened.
      if (!top || layer.rank >= top.rank) top = { id, ...layer };
    }
    if (!top) return;
    layers.delete(top.id);
    top.close();
    arm();
  });

  return {
    add(close: () => void, rank: number) {
      const id = Symbol('phone-back-layer');
      layers.set(id, { close, rank });
      arm();
      return () => {
        if (!layers.delete(id) || deferred) return;
        deferred = true;
        // Batch close→open replacements and StrictMode's setup/cleanup/setup.
        port.defer(settle);
      };
    },
  };
}
