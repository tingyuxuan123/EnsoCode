import { readdirSync } from 'node:fs';
import path from 'node:path';
import { STATIC_PROVIDER_DEFINITIONS } from '@shared/providerCatalog';
import { describe, expect, it } from 'vitest';
import { ASSET_LOGO_SYMBOLS, resolveProviderLogo } from './providerLogos';

const ASSET_DIR = path.resolve(import.meta.dirname, '../../assets/provider-icons');
const ASSET_FILES = new Set(readdirSync(ASSET_DIR).filter((file) => file.endsWith('.svg')));

describe('向导厂商 logo', () => {
  it('Custom 不挂品牌标', () => {
    expect(resolveProviderLogo('__custom', 'Custom')).toBeNull();
  });

  it('静态厂商（除 Custom）都有标：品牌 path 或字母兜底', () => {
    for (const definition of STATIC_PROVIDER_DEFINITIONS) {
      if (definition.id === '__custom') continue;
      const logo = resolveProviderLogo(definition.id, definition.label);
      expect(logo, definition.id).not.toBeNull();
      expect(logo?.kind === 'mark' || logo?.kind === 'letter' || logo?.kind === 'asset').toBe(true);
    }
  });

  it('订阅扩展 id 复用对应厂商标', () => {
    const openai = resolveProviderLogo('openai', 'OpenAI');
    const google = resolveProviderLogo('google', 'Google');
    const moonshot = resolveProviderLogo('moonshot', 'Moonshot');
    expect(resolveProviderLogo('openai-codex', 'OpenAI Codex')).toEqual(openai);
    expect(resolveProviderLogo('google-antigravity', 'Google Antigravity')).toEqual(google);
    expect(resolveProviderLogo('google-vertex', 'Google Vertex')).toEqual(google);
    expect(resolveProviderLogo('kimi-coding', 'Kimi')).toEqual(moonshot);
    expect(resolveProviderLogo('github-copilot', 'GitHub Copilot')?.kind).toBe('mark');
    expect(resolveProviderLogo('cursor', 'Cursor')?.kind).toBe('mark');
    expect(resolveProviderLogo('devin', 'Devin')?.kind).toBe('mark');
    expect(resolveProviderLogo('zai', 'Z.AI')).toEqual(resolveProviderLogo('zhipu', 'Zhipu AI'));
  });

  it('有官方 SVG 的厂商标优先用资源，而不是内联 path', () => {
    // 内联 path 是单色手绘兜底；资源是官方 mark，能保留品牌配色。
    expect(resolveProviderLogo('anthropic')?.kind).toBe('asset');
    expect(resolveProviderLogo('deepseek')?.kind).toBe('asset');
    expect(resolveProviderLogo('magpie')?.kind).toBe('asset');
    expect(resolveProviderLogo('xai')?.kind).toBe('asset');
  });

  it('彩色标与单色标分开：单色标必须走 mask 染色', () => {
    // 单色标的 svg 写的是 fill="currentColor"，当 <img> 用会被解析成黑色，
    // 深色主题下等于看不见 —— 外观必须跟着资源走，不能统一处理。
    expect(resolveProviderLogo('anthropic')).toMatchObject({ appearance: 'color' });
    expect(resolveProviderLogo('openai')).toMatchObject({ appearance: 'monochrome' });
    expect(resolveProviderLogo('magpie')).toMatchObject({ appearance: 'monochrome' });
  });

  it('每个资源标都真的有文件，没有名字对不上的空标', () => {
    const missing = Object.values(ASSET_LOGO_SYMBOLS).filter(
      (symbol) => !ASSET_FILES.has(`${symbol}.svg`)
    );
    expect(missing).toEqual([]);
  });

  it('未知扩展厂商用展示名首字母，没有名称时用 id', () => {
    expect(resolveProviderLogo('acme-labs', 'Acme Labs')).toEqual({ kind: 'letter', letter: 'A' });
    expect(resolveProviderLogo('9lives')).toEqual({ kind: 'letter', letter: '9' });
  });
});
