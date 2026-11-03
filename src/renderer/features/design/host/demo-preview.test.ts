import { beforeEach, describe, expect, it } from 'vitest';
import type { DesignSystem } from '../vetta/src/design-systems/types';
import { openDemoInBrowser } from '../vetta/src/gallery/open-demo';
import {
  closeDesignDemoPreview,
  sandboxDesignDemoHtml,
  useDesignDemoPreview,
} from './demo-preview';

const system: DesignSystem = {
  id: 'example',
  name: 'Example',
  category: 'dev',
  vibe: 'light',
  blurb: '',
  resources: [],
  themeCss: '',
  designMd: '',
};

beforeEach(closeDesignDemoPreview);

describe('sandboxed catalog demo', () => {
  it('preserves root presentation attributes without restoring executable root handlers', () => {
    const doc = new DOMParser().parseFromString(
      sandboxDesignDemoHtml(`
      <!doctype html><html lang="zh" class="dark" data-theme="night" onload="bad()">
      <body class="demo" style="--label: 'a>b'; margin: 0" onpageshow="bad()"><h1>Demo</h1></body></html>
    `),
      'text/html'
    );
    expect(doc.documentElement.lang).toBe('zh');
    expect(doc.documentElement.className).toBe('dark');
    expect(doc.documentElement.dataset.theme).toBe('night');
    expect(doc.body.className).toBe('demo');
    expect(doc.body.getAttribute('style')).toContain("'a>b'");
    expect(doc.querySelector('[onload], [onpageshow]')).toBeNull();
  });

  it('keeps visual HTML and inline styles, with a restrictive CSP before any catalog markup', () => {
    const doc = new DOMParser().parseFromString(
      sandboxDesignDemoHtml(
        '<!doctype html><html><head><style>h1{color:red}</style></head><body><h1>Preview</h1></body></html>'
      ),
      'text/html'
    );
    expect(doc.head.firstElementChild?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    const policy = doc.head.firstElementChild?.getAttribute('content');
    for (const rule of [
      "default-src 'none'",
      "script-src 'none'",
      "connect-src 'none'",
      "frame-src 'none'",
      "form-action 'none'",
      "base-uri 'none'",
    ]) {
      expect(policy).toContain(rule);
    }
    expect(policy).not.toContain('https:');
    expect(doc.querySelector('style')?.textContent).toContain('color:red');
    expect(doc.querySelector('h1')?.textContent).toBe('Preview');
  });

  it('removes executable content, refreshes, navigation, nested documents and resource URLs', () => {
    const doc = new DOMParser().parseFromString(
      sandboxDesignDemoHtml(`
      <meta http-equiv="refresh" content="0;url=file:///etc/passwd"><base href="file:///">
      <script>alert(1)</script><iframe srcdoc="bad"></iframe><object data="file:///bad"></object>
      <link rel="stylesheet" href="https://evil.test/style.css"><a href="file:///bad" ping="https://evil.test">Go</a>
      <form action="https://evil.test"><button formaction="file:///bad">Send</button></form>
      <img src="https://evil.test/track" srcset="https://evil.test/track 2x" onerror="alert(1)">
      <img id="embedded" src="data:image/png;base64,aA=="><svg><use href="#icon"></use></svg>
    `),
      'text/html'
    );
    expect(
      doc.querySelector('script, iframe, object, link, base, meta[http-equiv="refresh"]')
    ).toBeNull();
    expect(
      doc.querySelector('[href="file:///bad"], [action], [formaction], [ping], [srcset], [onerror]')
    ).toBeNull();
    expect(doc.querySelector('img:not(#embedded)')?.hasAttribute('src')).toBe(false);
    expect(doc.querySelector('#embedded')?.getAttribute('src')).toBe('data:image/png;base64,aA==');
    expect(doc.querySelector('use')?.getAttribute('href')).toBe('#icon');
  });

  it('opens in-app without filesystem/command APIs and closes without keeping demo contents', async () => {
    expect(await openDemoInBrowser(system)).toBe(false);
    expect(useDesignDemoPreview.getState().preview).toBeNull();
    const html = '<h1>Full preview</h1><script>bad()</script>';
    expect(
      await openDemoInBrowser({
        ...system,
        resources: [
          { path: 'demo.html', role: 'demo', encoding: 'text', content: html, bytes: html.length },
        ],
      })
    ).toBe(true);
    expect(useDesignDemoPreview.getState().preview?.name).toBe('Example');
    expect(useDesignDemoPreview.getState().preview?.html).toContain('Full preview');
    expect(useDesignDemoPreview.getState().preview?.html).not.toContain('<script>');
    closeDesignDemoPreview();
    expect(useDesignDemoPreview.getState().preview).toBeNull();
  });
});
