import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { resolveDesignRoot } from './roots';

vi.mock('./roots', () => ({ resolveDesignRoot: vi.fn() }));

import { DesignWatchService } from './watch';

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
it('递归 watch 去抖推送 watchId，非 owner 不能 unwatch，owner 释放后不再推送', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'design-watch-'));
  temps.push(dir);
  await mkdir(path.join(dir, 'a.vetd/frames'), { recursive: true });
  const root = { kind: 'project', projectId: 'p' } as const;
  vi.mocked(resolveDesignRoot).mockResolvedValue({ ref: root, path: dir });
  const send = vi.fn();
  const watch = new DesignWatchService(send);
  try {
    const result = await watch.start(1, { root, rel: 'a.vetd' });
    if (!result.ok) throw new Error('No watch');
    watch.stop(2, result.watchId);
    await writeFile(path.join(dir, 'a.vetd/frames/a.tsx'), 'a');
    await writeFile(path.join(dir, 'a.vetd/frames/a.tsx'), 'b');
    await vi.waitFor(
      () => expect(send).toHaveBeenCalledWith(1, 'design:watch-event', { watchId: result.watchId }),
      { timeout: 2000 }
    );
    expect(send).toHaveBeenCalledOnce();
    watch.releaseOwner(1);
    send.mockClear();
    await writeFile(path.join(dir, 'a.vetd/frames/a.tsx'), 'c');
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(send).not.toHaveBeenCalled();
  } finally {
    watch.dispose();
  }
});
