import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateLegacyUserData } from './userDataMigration';

let appData = '';

function seed(relative: string, content = 'hello'): string {
  const file = path.join(appData, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return file;
}

beforeEach(() => {
  appData = mkdtempSync(path.join(tmpdir(), 'codekiln-userdata-'));
});

afterEach(() => {
  rmSync(appData, { recursive: true, force: true });
});

describe('migrateLegacyUserData', () => {
  it('把旧品牌数据目录整体挪到新目录', () => {
    seed('enso-code/agent/sessions/s1.jsonl', '{"id":"s1"}');
    seed('enso-code/settings.json', '{"theme":"dark"}');

    const result = migrateLegacyUserData({
      appData,
      target: 'codekiln',
      legacy: ['enso-code'],
    });

    expect(result).toEqual({ migrated: true, from: 'enso-code', copied: false });
    const migrated = path.join(appData, 'codekiln/agent/sessions/s1.jsonl');
    expect(existsSync(migrated)).toBe(true);
    expect(readFileSync(migrated, 'utf8')).toBe('{"id":"s1"}');
    expect(existsSync(path.join(appData, 'codekiln/settings.json'))).toBe(true);
    expect(existsSync(path.join(appData, 'enso-code'))).toBe(false);
  });

  it('新目录已有数据时不动手，也不删旧目录', () => {
    seed('enso-code/settings.json', 'old');
    seed('codekiln/settings.json', 'new');

    const result = migrateLegacyUserData({
      appData,
      target: 'codekiln',
      legacy: ['enso-code'],
    });

    expect(result).toEqual({ migrated: false, reason: 'target-exists' });
    expect(readFileSync(path.join(appData, 'codekiln/settings.json'), 'utf8')).toBe('new');
    expect(readFileSync(path.join(appData, 'enso-code/settings.json'), 'utf8')).toBe('old');
  });

  it('没有旧目录时什么都不做', () => {
    expect(
      migrateLegacyUserData({ appData, target: 'codekiln', legacy: ['enso-code', 'enso-code-dev'] })
    ).toEqual({ migrated: false, reason: 'no-legacy' });
    expect(existsSync(path.join(appData, 'codekiln'))).toBe(false);
  });

  it('按顺序取第一个存在的旧目录（打包版优先于 dev 目录）', () => {
    seed('enso-code-dev/settings.json', 'dev');

    expect(
      migrateLegacyUserData({ appData, target: 'codekiln', legacy: ['enso-code', 'enso-code-dev'] })
    ).toEqual({ migrated: true, from: 'enso-code-dev', copied: false });
    expect(readFileSync(path.join(appData, 'codekiln/settings.json'), 'utf8')).toBe('dev');
  });

  it('重命名失败时退回复制并保留旧目录', () => {
    seed('enso-code/settings.json', 'keep-me');

    const result = migrateLegacyUserData({
      appData,
      target: 'codekiln',
      legacy: ['enso-code'],
      fs: {
        rename: () => {
          throw Object.assign(new Error('cross-device'), { code: 'EXDEV' });
        },
      },
    });

    expect(result).toEqual({ migrated: true, from: 'enso-code', copied: true });
    expect(readFileSync(path.join(appData, 'codekiln/settings.json'), 'utf8')).toBe('keep-me');
    expect(existsSync(path.join(appData, 'enso-code'))).toBe(true);
  });

  it('迁移异常不外抛，返回失败原因', () => {
    seed('enso-code/settings.json', 'x');

    const result = migrateLegacyUserData({
      appData,
      target: 'codekiln',
      legacy: ['enso-code'],
      fs: {
        rename: () => {
          throw new Error('EACCES');
        },
        copy: () => {
          throw new Error('EACCES');
        },
      },
    });

    expect(result).toEqual({ migrated: false, reason: 'failed' });
    expect(existsSync(path.join(appData, 'enso-code/settings.json'))).toBe(true);
  });
});
