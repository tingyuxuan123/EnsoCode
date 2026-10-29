import fs from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => {
  const dir = require('node:fs').mkdtempSync(`${require('node:os').tmpdir()}/enso-headers-scan-`);
  return { dir, file: `${dir}/settings.json` };
});
vi.mock('node:os', async (original) => {
  const actual = await original<typeof import('node:os')>();
  return { ...actual, default: { ...actual, homedir: () => fixture.dir } };
});
vi.mock('../../ipc/settings', () => ({ readSettings: () => ({}) }));
vi.mock('../providerScan/locations', () => ({ locateApp: () => ({ filePath: fixture.file }) }));

import { collectAssetImport, scanLocalAssets } from './index';

afterEach(() => fs.rmSync(fixture.dir, { recursive: true, force: true }));

it('扫描候选不泄漏 headers，确认导入保留完整 headers', () => {
  fs.writeFileSync(
    fixture.file,
    JSON.stringify({
      'enso-settings': {
        state: {
          mcpServers: [
            {
              name: 'remote',
              url: 'https://example.test/mcp',
              headers: { Authorization: 'Bearer fake-scan-token' },
            },
          ],
        },
      },
    })
  );
  const scan = scanLocalAssets();
  const candidate = scan.candidates.find((item) => item.kind === 'mcp');
  expect(candidate).toBeDefined();
  expect(JSON.stringify(scan)).not.toContain('fake-scan-token');
  expect(candidate).not.toHaveProperty('headers');
  expect(collectAssetImport(scan.scanId, [candidate!.id])).toMatchObject([
    { headers: { Authorization: 'Bearer fake-scan-token' } },
  ]);
});
