// @vitest-environment happy-dom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('./ProviderModelRow', () => ({ ProviderModelRow: () => null }));

import { ProviderApiForm } from './ProviderApiForm';

describe('stored provider key form', () => {
  it('已保存引用不写进可显示的密码输入框，并说明凭证保留在本机', () => {
    const marker = 'enso-secret:11111111-1111-4111-8111-111111111111';
    const html = renderToStaticMarkup(
      createElement(ProviderApiForm, {
        initialValue: {
          name: 'Stored',
          api: 'anthropic-messages',
          apiKey: marker,
          baseUrl: 'https://api.example',
          models: [],
        },
        oauth: false,
        onCancel: () => {},
        onSave: () => {},
      })
    );
    expect(html).not.toContain(marker);
    expect(html).toContain('Stored credentials stay on this computer.');
  });
});
