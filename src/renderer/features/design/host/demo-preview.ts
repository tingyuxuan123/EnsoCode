import { create } from 'zustand';

const DEMO_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

/** Fragment parsing drops html/body attributes. Recover only presentation metadata in another
 * inert template. This is not a security parser: even malformed/spoofed matches only copy this
 * allowlist, and CSS still cannot request resources under DEMO_CSP. Quoted '>' stays in the tag. */
function copyRootPresentation(html: string, doc: Document): void {
  for (const [pattern, target] of [
    [/<html\b(?:"[^"]*"|'[^']*'|[^'">])*>/i, doc.documentElement],
    [/<body\b(?:"[^"]*"|'[^']*'|[^'">])*>/i, doc.body],
  ] as const) {
    const opening = html.match(pattern)?.[0];
    if (!opening) continue;
    const attributes = doc.createElement('template');
    attributes.innerHTML = `${opening.replace(/^<\w+/, '<div')}</div>`;
    for (const { name, value } of [...(attributes.content.firstElementChild?.attributes ?? [])]) {
      if (['class', 'style', 'id', 'lang', 'dir'].includes(name) || name.startsWith('data-'))
        target.setAttribute(name, value);
    }
  }
}

/** Catalog HTML is untrusted. Keep static visuals only, even when its upstream validator changes.
 * CSP blocks CSS resource requests as well; iframe sandbox separately denies all script execution. */
export function sandboxDesignDemoHtml(html: string): string {
  // Template contents are inert: parsing must not fetch images/styles before CSP is installed.
  const doc = document.implementation.createHTMLDocument('');
  const template = doc.createElement('template');
  template.innerHTML = html;
  const content = template.content;
  for (const element of content.querySelectorAll(
    'script, meta, base, link, iframe, frame, frameset, object, embed, applet, portal, template, animate, animateMotion, animateTransform, set, discard'
  ))
    element.remove();
  for (const element of content.querySelectorAll('*')) {
    for (const { name, value } of [...element.attributes]) {
      const key = name.toLowerCase();
      if (
        key.startsWith('on') ||
        [
          'action',
          'formaction',
          'target',
          'download',
          'ping',
          'srcdoc',
          'srcset',
          'autofocus',
        ].includes(key) ||
        ((key === 'href' || key === 'xlink:href') && !value.startsWith('#')) ||
        (['src', 'poster', 'data', 'background'].includes(key) &&
          !(
            element.localName === 'img' &&
            key === 'src' &&
            /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml)[;,]/i.test(value)
          ))
      )
        element.removeAttribute(name);
    }
  }
  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = DEMO_CSP;
  doc.head.prepend(policy);
  doc.body.append(content);
  copyRootPresentation(html, doc);
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}

interface DesignDemoPreview {
  preview: { name: string; html: string } | null;
}
export const useDesignDemoPreview = create<DesignDemoPreview>(() => ({ preview: null }));

export function openDesignDemoPreview(name: string, html: string): void {
  useDesignDemoPreview.setState({ preview: { name, html: sandboxDesignDemoHtml(html) } });
}
export function closeDesignDemoPreview(): void {
  useDesignDemoPreview.setState({ preview: null });
}
