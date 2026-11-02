import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { PluginOwnerLifetimes } from './extensionPluginsOwners';

class Contents extends EventEmitter {
  destroyed = false;
  constructor(readonly id: number) {
    super();
  }
  isDestroyed() {
    return this.destroyed;
  }
}
it('已存在窗口和新窗口的销毁立即 abort，撤销暂存 token，重复注册只清理一次', () => {
  const release = vi.fn();
  const owners = new PluginOwnerLifetimes(release);
  const contents = new Contents(7);
  owners.attach(contents);
  owners.attach(contents);
  const signal = owners.signal(contents);
  expect(signal.aborted).toBe(false);
  contents.destroyed = true;
  contents.emit('destroyed');
  expect(signal.aborted).toBe(true);
  expect(release).toHaveBeenCalledExactlyOnceWith(7);
  expect(owners.signal(contents).aborted).toBe(true);
});
