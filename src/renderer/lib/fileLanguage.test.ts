import { describe, expect, it } from 'vitest';
import { fileLanguage } from './fileLanguage';

describe('fileLanguage', () => {
  it('把 .env 与 .env.* 归一为 dotenv', () => {
    expect(fileLanguage('.env')).toBe('dotenv');
    expect(fileLanguage('.env.development')).toBe('dotenv');
    expect(fileLanguage('.env.production.local')).toBe('dotenv');
    expect(fileLanguage('env/.env.development')).toBe('dotenv');
    expect(fileLanguage('/abs/project/env/.env.local')).toBe('dotenv');
  });

  it('不把其它以 .env 开头的名字误判成 dotenv', () => {
    expect(fileLanguage('.envrc')).toBeUndefined();
    expect(fileLanguage('.environment')).toBeUndefined();
    expect(fileLanguage('env.development')).toBeUndefined();
    expect(fileLanguage('dotenv.example')).toBeUndefined();
  });

  it('其它文件交给库按扩展名推断', () => {
    expect(fileLanguage('index.vue')).toBeUndefined();
    expect(fileLanguage('README.md')).toBeUndefined();
    expect(fileLanguage('')).toBeUndefined();
  });
});
