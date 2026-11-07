import { describe, expect, it } from 'vitest';
import { settingsSecrets } from './settingsSecrets';

const provider = {
  id: 'provider-test',
  api: 'anthropic-messages',
  baseUrl: 'https://api.example',
  apiKey: 'private-test-key',
};
const wrap = (providers: object[]) => ({ 'enso-settings': { state: { providers } } });
const didWrite = (data: Record<string, unknown>, source?: Record<string, unknown>) => {
  settingsSecrets.didWrite(data, source);
};
describe('opaque Main credential references', () => {
  it('引用稳定、非明文、不包含 key 的前后缀，删除后不可借旧引用恢复 key', () => {
    const current = wrap([provider]);
    const view = settingsSecrets.provider(provider);
    expect(view.apiKey).not.toContain('private');
    expect(settingsSecrets.provider(provider)).toEqual(view);
    expect(() => settingsSecrets.restoreSettings(wrap([view]), wrap([]))).toThrow();
    expect(settingsSecrets.restoreSettings(wrap([view]), current)).toEqual(current);
  });
  it('使用已保存 key 测试连接时由 Main 解引用，换地址拒绝且原 key 不暴露', () => {
    const view = settingsSecrets.provider(provider);
    expect(settingsSecrets.apiConfig(view, [provider])).toEqual(provider);
    expect(() =>
      settingsSecrets.apiConfig({ ...view, baseUrl: 'https://attacker.example' }, [provider])
    ).toThrow();
    expect(() => settingsSecrets.apiConfig(view, [])).toThrow();
    expect(() =>
      settingsSecrets.apiConfig(view, [{ ...provider, baseUrl: 'https://new.example' }])
    ).toThrow();
  });
  it('导入回包不带明文，写入后只能由本条目使用，不能重放为另一个条目', () => {
    const candidate = settingsSecrets.provider({ ...provider, candidateId: 'candidate' }, true);
    expect(candidate.apiKey).not.toBe(provider.apiKey);
    const saved = settingsSecrets.restoreSettings(
      wrap([{ ...candidate, id: 'new-provider' }]),
      wrap([])
    );
    didWrite(saved, wrap([{ ...candidate, id: 'new-provider' }]));
    expect(saved).toEqual(wrap([{ ...provider, candidateId: 'candidate', id: 'new-provider' }]));
    const projected = settingsSecrets.project(saved)!;
    const replay = { ...candidate, id: 'different-provider' };
    expect(() => settingsSecrets.restoreSettings(wrap([replay]), wrap([]))).toThrow();
    expect(JSON.stringify(projected)).not.toContain('private-test-key');
  });
  it('成功导入后原窗口的引用仍可回写，但删除后无法重放', () => {
    const candidate = settingsSecrets.provider({ ...provider, apiKey: 'unique-import-key' }, true);
    const saved = settingsSecrets.restoreSettings(
      wrap([{ ...candidate, id: 'imported' }]),
      wrap([])
    );
    didWrite(saved, wrap([{ ...candidate, id: 'imported' }]));
    settingsSecrets.project(saved); // another window rehydrates first
    expect(() =>
      settingsSecrets.restoreSettings(wrap([{ ...candidate, id: 'imported' }]), saved)
    ).not.toThrow();
    didWrite(wrap([]));
    expect(() =>
      settingsSecrets.restoreSettings(wrap([{ ...candidate, id: 'imported' }]), wrap([]))
    ).toThrow();
  });
  it('导入后不读设置也不能将已删除凭证再绑定其它条目', () => {
    const candidate = settingsSecrets.provider({ ...provider, apiKey: 'no-read-import-key' }, true);
    const saved = settingsSecrets.restoreSettings(wrap([{ ...candidate, id: 'first' }]), wrap([]));
    didWrite(saved, wrap([{ ...candidate, id: 'first' }]));
    didWrite(wrap([]));
    expect(() =>
      settingsSecrets.restoreSettings(wrap([{ ...candidate, id: 'second' }]), wrap([]))
    ).toThrow();
  });
  it('另一窗口先读时，未使用的导入引用不会误绑定到同连接的旧供应商', () => {
    const current = wrap([provider]);
    const candidate = settingsSecrets.provider(
      { ...provider, catalogId: 'different-vendor' },
      true
    );
    settingsSecrets.project(current);
    expect(() =>
      settingsSecrets.restoreSettings(wrap([provider, { ...candidate, id: 'different' }]), current)
    ).not.toThrow();
  });
});
