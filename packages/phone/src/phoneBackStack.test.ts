import { describe, expect, it, vi } from 'vitest';
import { createPhoneBackStack, type PhoneHistoryPort } from './phoneBackStack';

function fixture(initialState: unknown = { launch: 'preserved' }) {
  const entries: unknown[] = [{ outside: true }, initialState];
  let index = 1;
  const listeners = new Set<(state: unknown) => void>();
  const deferred: (() => void)[] = [];
  let pending = 0;
  const port: PhoneHistoryPort = {
    state: () => entries[index],
    push: vi.fn((state) => {
      entries.splice(index + 1);
      entries.push(state);
      index++;
    }),
    back: vi.fn(() => {
      pending++;
    }),
    listen: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    defer: (callback) => deferred.push(callback),
  };
  const flush = () => {
    while (deferred.length) deferred.shift()?.();
  };
  const finishBack = () => {
    expect(pending).toBeGreaterThan(0);
    pending--;
    index--;
    for (const listener of listeners) listener(entries[index]);
  };
  const back = () => {
    port.back();
    finishBack();
    flush();
  };
  const forward = () => {
    index++;
    for (const listener of listeners) listener(entries[index]);
    flush();
  };
  return {
    port,
    stack: createPhoneBackStack(port),
    entries,
    flush,
    finishBack,
    back,
    forward,
    index: () => index,
  };
}

describe('PWA internal back navigation', () => {
  it('a cold-open list consumes Back inside the same document before the browser can exit', () => {
    const f = fixture();
    const close = vi.fn();
    f.stack.add(close, 10);
    expect(f.port.state()).toMatchObject({ launch: 'preserved' });
    expect(f.entries).toHaveLength(3);
    f.back();
    expect(close).toHaveBeenCalledOnce();
    expect(f.index()).toBe(1);
    f.back();
    expect(close).toHaveBeenCalledOnce();
    expect(f.index()).toBe(0); // Leaving is allowed once there is nothing internal to close.
  });

  it('settings close first even when a parent list registers after its child', () => {
    const f = fixture();
    const settings = vi.fn();
    const list = vi.fn();
    f.stack.add(settings, 30);
    f.stack.add(list, 10);
    expect(f.entries).toHaveLength(3); // One guard, not an ever-growing fake route history.
    f.back();
    expect(settings).toHaveBeenCalledOnce();
    expect(list).not.toHaveBeenCalled();
    expect(f.index()).toBe(2); // Re-armed for the still-open list.
    f.back();
    expect(list).toHaveBeenCalledOnce();
    expect(f.index()).toBe(1);
  });

  it('explicit close consumes its guard without closing a different screen', () => {
    const f = fixture();
    const close = vi.fn();
    const remove = f.stack.add(close, 10);
    remove();
    f.flush();
    expect(f.port.back).toHaveBeenCalledOnce();
    f.finishBack();
    expect(close).not.toHaveBeenCalled();
    expect(f.index()).toBe(1);
  });

  it('StrictMode setup/cleanup/setup reuses its guard and never pops the document', () => {
    const f = fixture();
    f.stack.add(vi.fn(), 10)();
    const close = vi.fn();
    f.stack.add(close, 10);
    f.flush();
    expect(f.port.push).toHaveBeenCalledOnce();
    expect(f.port.back).not.toHaveBeenCalled();
    f.back();
    expect(close).toHaveBeenCalledOnce();
  });

  it('opening another screen before an explicit-close traversal completes does not lose its guard', () => {
    const f = fixture();
    f.stack.add(vi.fn(), 10)();
    f.flush();
    const close = vi.fn();
    f.stack.add(close, 50);
    f.finishBack();
    expect(close).not.toHaveBeenCalled();
    expect(f.index()).toBe(2);
    f.back();
    expect(close).toHaveBeenCalledOnce();
  });

  it('switching from a list to a new-session sheet keeps exactly one guard', () => {
    const f = fixture();
    const remove = f.stack.add(vi.fn(), 10);
    const sheet = vi.fn();
    remove();
    f.stack.add(sheet, 50);
    f.flush();
    expect(f.port.back).not.toHaveBeenCalled();
    expect(f.port.push).toHaveBeenCalledOnce();
    f.back();
    expect(sheet).toHaveBeenCalledOnce();
    expect(f.index()).toBe(1);
  });

  it('removing one nested layer does not pop the underlying list', () => {
    const f = fixture();
    const list = vi.fn();
    f.stack.add(list, 10);
    f.stack.add(vi.fn(), 50)();
    f.flush();
    expect(f.port.back).not.toHaveBeenCalled();
    f.back();
    expect(list).toHaveBeenCalledOnce();
  });

  it('a refreshed guard is reused', () => {
    const first = fixture();
    first.stack.add(vi.fn(), 10);
    const f = fixture(first.port.state());
    const close = vi.fn();
    f.stack.add(close, 10);
    expect(f.port.push).not.toHaveBeenCalled();
    // The guard survived reload; back consumes it rather than creating a second guard.
    f.back();
    expect(close).toHaveBeenCalledOnce();
  });

  it('Forward skips a closed guard without leaving an extra empty Back step', () => {
    const f = fixture();
    const close = vi.fn();
    f.stack.add(close, 10);
    f.back();
    f.forward();
    f.finishBack();
    expect(close).toHaveBeenCalledOnce();
    expect(f.port.state()).toEqual({ launch: 'preserved' });
    expect(f.index()).toBe(1);
    f.back();
    expect(f.index()).toBe(0);
  });

  it('repeated open/close/Forward cycles do not grow the back history', () => {
    const f = fixture();
    for (let i = 0; i < 5; i++) {
      const remove = f.stack.add(vi.fn(), 10);
      remove();
      f.flush();
      f.finishBack();
      f.forward();
      f.finishBack();
      expect(f.index()).toBe(1);
      expect(f.entries).toHaveLength(3);
    }
  });

  it('a browser denying pushState still allows a normal explicit close', () => {
    const f = fixture();
    vi.mocked(f.port.push).mockImplementation(() => {
      throw new Error('denied');
    });
    const close = vi.fn();
    const remove = f.stack.add(close, 10);
    remove();
    f.flush();
    expect(f.port.back).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
