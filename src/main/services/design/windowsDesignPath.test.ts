import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { toDesignSdkPath } from '@shared/design/paths';
import { expect, it } from 'vitest';
import { DesignPaths } from '../../../renderer/features/design/host/paths';
import { checkedPath } from './security';

it('round-trips a native workspace through the design SDK', async () => {
  const temp = await mkdtemp(path.join(tmpdir(), 'enso-design-path-'));
  try {
    const workspace = path.join(temp, '项目');
    const design = path.join(workspace, '交稿.vetd');
    await mkdir(design, { recursive: true });
    await writeFile(path.join(design, 'design.json'), '{}');
    const native = await realpath(workspace);
    const sdk = toDesignSdkPath(native);
    if (process.platform === 'win32') {
      expect(native).toMatch(/^[a-z]:\\/i);
      expect(sdk).toMatch(/^[A-Z]:\//);
    }
    const ref = { kind: 'session' as const, sessionId: 'design-session' };
    const paths = new DesignPaths();
    paths.remember({ ref, path: sdk });
    const file = paths.map(`${sdk}/交稿.vetd/design.json`);
    expect(file).toEqual({ root: ref, rel: '交稿.vetd/design.json' });
    expect(await checkedPath(native, file.rel)).toBe(
      await realpath(path.join(design, 'design.json'))
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
