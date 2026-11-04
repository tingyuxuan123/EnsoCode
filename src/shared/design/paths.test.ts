import { expect, it } from 'vitest';
import { toDesignSdkPath, validateDesignAbsolutePath } from './paths';

it.each([
  ['c:\\项目\\设计', 'C:/项目/设计'],
  ['d:/项目/设计', 'D:/项目/设计'],
  ['c:\\', 'C:/'],
  ['C:/', 'C:/'],
  ['/private/项目', '/private/项目'],
  ['/', '/'],
])('converts native local root %s to SDK path %s', (native, sdk) => {
  expect(toDesignSdkPath(native)).toBe(sdk);
  expect(validateDesignAbsolutePath(sdk)).toBe(sdk);
});

it.each([
  '\\\\server\\share',
  '//server/share',
  '\\\\?\\C:\\app',
  '\\\\.\\C:\\app',
  '//?/C:/app',
  'C:app',
  'relative',
  '/C:/app',
  'C:\\a\\..\\b',
  'C:\\a\\.\\b',
  'C:\\a\0b',
  '/a/../b',
  '/a/./b',
  '/a\0b',
])('rejects unsupported or unsafe root %s rather than hiding it in normalization', (path) => {
  expect(() => toDesignSdkPath(path)).toThrow();
});

it.each(['c:/app', 'C:\\app', 'C:app', '//host/share', '/C:/app', 'C:/a/../b'])(
  'SDK validation rejects noncanonical path %s',
  (path) => {
    expect(() => validateDesignAbsolutePath(path)).toThrow();
  }
);

it('keeps the drive-root slash while trimming directory trailing slashes', () => {
  expect(validateDesignAbsolutePath('C:/')).toBe('C:/');
  expect(validateDesignAbsolutePath('C:/项目/')).toBe('C:/项目');
  expect(validateDesignAbsolutePath('/项目/')).toBe('/项目');
});
