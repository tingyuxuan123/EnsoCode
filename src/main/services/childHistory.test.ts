import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChildConversationMetadata } from '@shared/types/agent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readChildHistory } from './childHistory';

const instanceId = '11111111-1111-4111-8111-111111111111';
const generation = '22222222-2222-4222-8222-222222222222';
const childId = `parent::cw-${instanceId}`;
const metadata: ChildConversationMetadata = {
  parentId: 'parent',
  childGeneration: generation,
  agentTypeKey: 'builtin:coder',
  agentInstanceId: instanceId,
  agentInstanceName: 'General-11111111',
  dispatchOrigin: 'agent-tool',
};
const piHeader = {
  type: 'session',
  version: 3,
  id: 'pi-session-id',
  cwd: '/repo',
  timestamp: '2026-01-01T00:00:00Z',
};
const piEntries = (count: number, text = (i: number) => `m${i}`) =>
  Array.from({ length: count }, (_, i) => ({
    type: 'message',
    id: `entry-${i}`,
    parentId: i === 0 ? null : `entry-${i - 1}`,
    timestamp: piHeader.timestamp,
    message: {
      role: 'user',
      content: text(i),
      timestamp: i,
      apiKey: 'secret',
      providerData: { auth: 'secret' },
    },
  }));

describe('child 历史只读分流', () => {
  let tmp: string;
  let sessionDir: string;
  let records: Record<string, Record<string, unknown>>;
  const write = (name: string, lines: unknown[]) => {
    const file = path.join(sessionDir, name);
    writeFileSync(file, lines.map((line) => JSON.stringify(line)).join('\n'));
    return file;
  };
  const read = (id = childId, beforeIndex?: number) =>
    readChildHistory(id, beforeIndex, {
      sessionDir,
      persistedConversation: (key) => records[key] ?? null,
    });
  const ordinary = (lines: unknown[] = [piHeader, ...piEntries(80)]) => {
    records[childId] = {
      parentId: 'parent',
      child: metadata,
      sessionFile: write('normal.jsonl', lines),
    };
  };
  const locked = (extra: unknown[] = []) => {
    const child = { ...metadata, agentTypeKey: 'agent:enso', lockedProfileId: 'enso-locked-v1' };
    const identity = {
      sessionId: childId,
      generation,
      parent: { sessionId: 'parent', generation: '33333333-3333-4333-8333-333333333333' },
      instanceId,
      instanceName: metadata.agentInstanceName,
      typeKey: 'agent:enso',
      profileId: 'enso-locked-v1',
    };
    records[childId] = {
      parentId: 'parent',
      child,
      sessionFile: write('enso-child.jsonl', [
        { type: 'enso-safe-session', version: 1, child: identity, cwd: '/repo', createdAt: 1 },
        { type: 'safe-assistant-text', text: 'safe', at: 1 },
        ...extra,
      ]),
    };
  };
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), 'enso-child-history-'));
    sessionDir = path.join(tmp, 'sessions');
    mkdirSync(sessionDir);
    records = { parent: { id: 'parent' } };
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('普通 child 返回白名单尾窗和绝对游标，分页且不改写无换行 JSONL', async () => {
    ordinary();
    const file = String(records[childId].sessionFile);
    const before = readFileSync(file, 'utf8');
    const result = await read();
    expect(result).toMatchObject({ ok: true, source: 'tail', baseIndex: 20 });
    if (result.ok && 'messages' in result) {
      expect(result.messages).toHaveLength(60);
      expect(result.messages[0]).toEqual({
        role: 'user',
        content: [{ type: 'text', text: 'm20' }],
        timestamp: 20,
        entryId: 'entry-20',
      });
      expect(JSON.stringify(result)).not.toContain('secret');
    }
    expect(await read(childId, 20)).toMatchObject({
      ok: true,
      source: 'tail',
      baseIndex: 0,
      messages: expect.arrayContaining([
        { role: 'user', content: [{ type: 'text', text: 'm0' }], timestamp: 0, entryId: 'entry-0' },
      ]),
    });
    expect(await read(childId, 0)).toEqual({
      ok: true,
      source: 'tail',
      messages: [],
      baseIndex: 0,
    });
    expect(readFileSync(file, 'utf8')).toBe(before);
    for (const version of [2, 3]) {
      ordinary([{ ...piHeader, version }]);
      const empty = readFileSync(file, 'utf8');
      expect(await read()).toEqual({ ok: true, source: 'tail', messages: [], baseIndex: 0 });
      expect(readFileSync(file, 'utf8')).toBe(empty);
    }
  });

  it('尾窗同时遵守字节预算，并只走当前 branch', async () => {
    ordinary([
      piHeader,
      ...piEntries(3, () => 'x'.repeat(600_000)),
      ...piEntries(1).map((entry) => ({
        ...entry,
        id: 'new-branch',
        parentId: 'entry-0',
        message: { role: 'user', content: 'new branch', timestamp: 4 },
      })),
    ]);
    const result = await read();
    expect(result).toMatchObject({ ok: true, source: 'tail', baseIndex: 1 });
    if (result.ok && 'messages' in result)
      expect(result.messages.map((message) => message.timestamp)).toEqual([4]);
  });

  it('locked Enso 只返回 safe projection，禁止 record 附带未白名单字段', async () => {
    locked();
    expect(await read()).toEqual({
      ok: true,
      source: 'history',
      projection: {
        records: [{ type: 'safe-assistant-text', text: 'safe', at: 1 }],
        partial: false,
      },
    });
    locked([{ type: 'safe-user-text', text: 'unsafe extension', at: 2, apiKey: 'secret' }]);
    expect(await read()).toMatchObject({ ok: false, code: 'unavailable' });
  });

  it('未知 ID、根会话、缺父记录或伪造父/实例归属均失败', async () => {
    ordinary();
    expect(await read('unknown')).toMatchObject({ ok: false, code: 'not-found' });
    expect(await read('parent')).toMatchObject({ ok: false });
    const valid = records[childId];
    for (const patch of [
      { id: 'foreign' },
      { parentId: 'foreign' },
      { child: { ...metadata, parentId: 'foreign' } },
      { child: { ...metadata, agentInstanceId: generation } },
      { child: undefined },
    ]) {
      records[childId] = { ...valid, ...patch };
      expect(await read()).toMatchObject({ ok: false, code: 'unavailable' });
    }
    records[childId] = valid;
    delete records.parent;
    expect(await read()).toMatchObject({ ok: false, code: 'unavailable' });
  });

  it('拒绝越界路径、文件/目录 symlink 逃逸和父会话文件别名', async () => {
    ordinary();
    const outside = path.join(tmp, 'outside.jsonl');
    writeFileSync(outside, JSON.stringify(piHeader));
    const link = path.join(sessionDir, 'link.jsonl');
    symlinkSync(outside, link);
    const dirLink = path.join(sessionDir, 'linked-dir');
    symlinkSync(tmp, dirLink);
    for (const file of [outside, link, path.join(dirLink, 'outside.jsonl'), sessionDir]) {
      records[childId].sessionFile = file;
      expect(await read()).toMatchObject({ ok: false, code: 'unavailable' });
    }
    ordinary();
    records.parent.sessionFile = records[childId].sessionFile;
    expect(await read()).toMatchObject({ ok: false, code: 'unavailable' });
  });

  it('历史类型与文件头必须一致，safe journal 身份不可串 child', async () => {
    ordinary();
    const piFile = records[childId].sessionFile;
    locked();
    const safeFile = records[childId].sessionFile;
    const safeContent = readFileSync(String(safeFile), 'utf8');
    records[childId].sessionFile = piFile;
    expect(await read()).toMatchObject({ ok: false, code: 'unavailable' });
    ordinary();
    records[childId].sessionFile = safeFile;
    expect(await read()).toMatchObject({ ok: false, code: 'unavailable' });
    ordinary();
    writeFileSync(String(records[childId].sessionFile), safeContent);
    expect(await read()).toMatchObject({ ok: false, code: 'unavailable' });
    locked();
    writeFileSync(String(records[childId].sessionFile), JSON.stringify(piHeader));
    expect(await read()).toMatchObject({ ok: false, code: 'unavailable' });
    locked();
    const safe = readFileSync(String(records[childId].sessionFile), 'utf8').replaceAll(
      childId,
      'other::cw-other'
    );
    writeFileSync(String(records[childId].sessionFile), safe);
    expect(await read()).toMatchObject({ ok: false, code: 'unavailable' });
  });

  it('缺失文件给 not-found，坏 JSON/头/消息/树结构给 unavailable 且不改文件', async () => {
    ordinary();
    rmSync(String(records[childId].sessionFile));
    expect(await read()).toMatchObject({ ok: false, code: 'not-found' });
    for (const lines of [
      [],
      [piHeader, null],
      [{ ...piHeader, version: 999 }],
      [piHeader, { ...piEntries(1)[0], message: null }],
      [piHeader, { ...piEntries(1)[0], parentId: 'missing' }],
      [piHeader, ...piEntries(1), ...piEntries(1)],
    ]) {
      ordinary(lines);
      const file = String(records[childId].sessionFile);
      const before = readFileSync(file, 'utf8');
      expect(await read()).toMatchObject({ ok: false, code: 'unavailable' });
      expect(readFileSync(file, 'utf8')).toBe(before);
    }
    writeFileSync(String(records[childId].sessionFile), '{bad json');
    expect(await read()).toMatchObject({ ok: false, code: 'unavailable' });
  });

  it('服务层也拒绝脏分页游标', async () => {
    ordinary();
    for (const cursor of [
      -1,
      0.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(await read(childId, cursor)).toMatchObject({ ok: false, code: 'unavailable' });
    }
  });
});
