import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { closeDesignDemoPreview, openDesignDemoPreview } from '../host/demo-preview';
import { DesignDemoViewer } from './DesignDemoViewer';

vi.mock('../host/translation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('full catalog demo viewer', () => {
  it('uses host dialog slots with an opaque, non-scriptable iframe and clears on unmount', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<DesignDemoViewer />));
    await act(async () => openDesignDemoPreview('Example', '<h1>Static demo</h1>'));
    const popup = document.querySelector('[data-slot="dialog-popup"]');
    expect(popup).not.toBeNull();
    expect(popup?.querySelector('[data-vetta-plugin-root]')).not.toBeNull();
    expect(popup?.querySelector('[data-slot="dialog-header"]')).not.toBeNull();
    expect(popup?.querySelector('[data-slot="dialog-panel"]')).not.toBeNull();
    const frame = popup?.querySelector('iframe');
    expect(frame?.getAttribute('sandbox')).toBe('');
    expect(frame?.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame?.getAttribute('srcdoc')).toContain("script-src 'none'");
    await act(async () => closeDesignDemoPreview());
    expect(document.querySelector('iframe')).toBeNull();
    await act(async () => root.unmount());
    host.remove();
  });
});
