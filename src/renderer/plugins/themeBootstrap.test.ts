import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { expect, it } from 'vitest';
import { PLUGIN_THEME_VARIABLES } from './themeBridge';

it('the sandbox applies initial and live theme tokens without changing CSP or accepting arbitrary CSS', async () => {
  const window = new Window({
    url: 'http://localhost/plugin-view.html#theme-test',
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
    },
  });
  try {
    const html = readFileSync(new URL('../public/plugin-view.html', import.meta.url), 'utf8');
    window.document.write(html.replace(/<script>[\s\S]*?<\/script>/, ''));
    window.eval(html.match(/<script>([\s\S]*?)<\/script>/)![1]);
    const port: { onmessage?: (event: { data: unknown }) => void } = {};
    const data = {
      type: 'enso-view-init',
      nonce: 'theme-test',
      theme: 'light',
      themeVariables: { '--panel': '#123456', '--private-path': 'secret' },
      html: '<p>Plugin content</p>',
    };
    // Use the VM's canonical WindowProxy for the same strict parent identity check as Chromium.
    const event = new window.MessageEvent('message', {
      source: window.eval('window.parent'),
      data,
    });
    Object.defineProperty(event, 'ports', { value: [port] });
    window.dispatchEvent(event);
    expect(window.document.documentElement.style.getPropertyValue('--panel')).toBe('#123456');
    expect(window.document.documentElement.style.getPropertyValue('--private-path')).toBe('');
    expect(window.document.body.textContent).toContain('Plugin content');
    for (const name of PLUGIN_THEME_VARIABLES) {
      port.onmessage?.({
        data: { type: 'enso-theme', theme: 'dark', variables: { [name]: 'test-value' } },
      });
      expect(window.document.documentElement.style.getPropertyValue(name)).toBe('test-value');
    }
    port.onmessage?.({
      data: {
        type: 'enso-theme',
        theme: 'light',
        variables: {
          '--panel': 'url(https://untrusted.invalid)',
          '--primary': 'red;display:none',
          '--foreground': '#abcdef',
        },
      },
    });
    expect(window.document.documentElement.style.getPropertyValue('--panel')).toBe('');
    expect(window.document.documentElement.style.getPropertyValue('--primary')).toBe('');
    expect(window.document.documentElement.style.getPropertyValue('--foreground')).toBe('#abcdef');
    expect(
      window.document
        .querySelector('meta[http-equiv="Content-Security-Policy"]')
        ?.getAttribute('content')
    ).toContain("connect-src 'none'");
    expect(window.document.documentElement.dataset.theme).toBe('light');
  } finally {
    await window.happyDOM.close();
  }
});
