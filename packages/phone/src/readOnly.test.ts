import { describe, expect, it } from 'vitest';
import { readOnlyBanner } from './readOnly';

describe('只读设备提示', () => {
  it('host 以只读拒绝时明确提示「此设备为只读」', () => {
    expect(readOnlyBanner(false)).toContain('此设备为只读');
    expect(readOnlyBanner(true)).toContain('此设备为只读');
    expect(readOnlyBanner(true)).toContain('未执行');
  });
});
