import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DESIGN_TOOL_NAMES } from '@shared/types/design';
import { describe, expect, it } from 'vitest';
import { DesignPresence, designToolNames, isDesignPath } from './designGate';

describe('design gate', () => {
  it('disabled is empty; no design exposes only entry tools; presence exposes all (skill alone is not a trigger)', () => {
    expect(designToolNames(false, true)).toEqual([]);
    expect(designToolNames(true, false)).toEqual(['vetd_create', 'vetd_sizes']);
    expect(designToolNames(true, true)).toEqual(DESIGN_TOOL_NAMES);
    for (const file of ['x.vetd/design.json', 'sub/x.vetd', 'x.vetd.d/design.json'])
      expect(isDesignPath(file)).toBe(true);
    for (const file of [
      'x.vetd/frame.vetd',
      'x.vetd.d/nested.vetd',
      'design.json',
      'x.vetdz',
      'x.vetd/theme.css',
    ])
      expect(isDesignPath(file)).toBe(false);
  });
  it('caches by cwd, refreshes after create, bounds traversal and does not follow symlinks', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'enso-design-gate-'));
    try {
      const presence = new DesignPresence();
      expect(await presence.has(cwd)).toBe(false);
      await mkdir(join(cwd, 'sub', 'demo.vetd'), { recursive: true });
      await writeFile(join(cwd, 'sub', 'demo.vetd', 'design.json'), '{}');
      expect(await presence.has(cwd)).toBe(false);
      presence.created(cwd);
      expect(await presence.has(cwd)).toBe(true);
      expect(await new DesignPresence().has(cwd)).toBe(true);
      expect(await new DesignPresence({ maxEntries: 0 }).has(cwd)).toBe(false);
      expect(await presence.has(join(cwd, 'missing'))).toBe(false);
      const links = join(cwd, 'links');
      await mkdir(join(links, '.hidden', 'secret.vetd'), { recursive: true });
      await writeFile(join(links, '.hidden', 'secret.vetd', 'design.json'), '{}');
      await symlink(join(links, '.hidden'), join(links, 'public-link'));
      expect(await new DesignPresence().has(links)).toBe(false);
      expect(await new DesignPresence({ maxDepth: 0 }).has(cwd)).toBe(false);
      await writeFile(join(links, 'legacy.vetd'), '{}');
      expect(await new DesignPresence().has(links)).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
  it('re-scans a negative answer once it expires, so designs added mid-session open the gate', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'enso-design-gate-ttl-'));
    try {
      let now = 0;
      const presence = new DesignPresence({ negativeTtlMs: 1000, now: () => now });
      expect(await presence.has(cwd)).toBe(false);
      await mkdir(join(cwd, 'cloned.vetd'), { recursive: true });
      await writeFile(join(cwd, 'cloned.vetd', 'design.json'), '{}');
      now = 999;
      expect(await presence.has(cwd)).toBe(false);
      now = 1000;
      expect(await presence.has(cwd)).toBe(true);
      await rm(join(cwd, 'cloned.vetd'), { recursive: true });
      now = 10_000;
      // A positive answer stays cached: hiding tools mid-session would only confuse the model.
      expect(await presence.has(cwd)).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
  it('a create that lands while an older scan is pending wins', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'enso-design-gate-race-'));
    try {
      const presence = new DesignPresence();
      const first = presence.has(cwd);
      // Second caller awaits the cached in-flight scan; create lands meanwhile.
      const waiting = presence.has(cwd);
      presence.created(cwd);
      expect(await first).toBe(false);
      expect(await waiting).toBe(true);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
