import { isPluginRelativePath } from '@shared/extensionPlugins/manifest';
export interface PluginViewAsset {
  mime: string;
  base64: string;
}
export function resolvePluginViewAsset(pagePath: string, ref: string): string | null {
  const value = ref.trim();
  if (
    !value ||
    value.length > 512 ||
    /^[\\/]/.test(value) ||
    /[\\\0?#]/.test(value) ||
    /^[a-z][a-z0-9+.-]*:/i.test(value)
  )
    return null;
  if (!isPluginRelativePath(pagePath)) return null;
  const parts = pagePath.split('/').slice(0, -1);
  for (const part of value.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  const result = parts.join('/');
  return isPluginRelativePath(result) ? result : null;
}
/** Only package-relative assets are read; CSP continues to block network URLs. */
export async function inlinePluginViewHtml(
  html: string,
  pagePath: string,
  readAsset: (rel: string) => Promise<PluginViewAsset | null>
): Promise<string> {
  // Do not create a DOM document here: some webviews load linked resources even in DOMParser.
  const attribute = (attrs: string, name: string) =>
    new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, 'i').exec(attrs);
  const value = (attrs: string, name: string) => {
    const match = attribute(attrs, name);
    return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
  };
  const slots: {
    start: number;
    end: number;
    full: string;
    attrs: string;
    kind: 'script' | 'style' | 'img';
    rel: string;
  }[] = [];
  for (const [kind, pattern, attr] of [
    ['script', /<script\b([^>]*)>[\s\S]*?<\/script>/gi, 'src'],
    ['style', /<link\b([^>]*?)\/?>/gi, 'href'],
    ['img', /<img\b([^>]*?)\/?>/gi, 'src'],
  ] as const) {
    for (const match of html.matchAll(pattern)) {
      const attrs = match[1] ?? '';
      if (
        kind === 'style' &&
        !value(attrs, 'rel')?.toLowerCase().split(/\s+/).includes('stylesheet')
      )
        continue;
      const ref = value(attrs, attr);
      const rel = ref === null ? null : resolvePluginViewAsset(pagePath, ref);
      if (rel)
        slots.push({
          start: match.index,
          end: match.index + match[0].length,
          full: match[0],
          attrs,
          kind,
          rel,
        });
    }
  }
  slots.sort((a, b) => a.start - b.start);
  const assets = new Map<string, PluginViewAsset | null>();
  await Promise.all(
    [...new Set(slots.map((slot) => slot.rel))].map(async (rel) => {
      assets.set(rel, await readAsset(rel));
    })
  );
  let cursor = 0;
  let result = '';
  for (const slot of slots) {
    if (slot.start < cursor) continue;
    result += html.slice(cursor, slot.start);
    cursor = slot.end;
    const asset = assets.get(slot.rel);
    if (!asset) {
      result += slot.full;
      continue;
    }
    if (slot.kind === 'img') {
      const match = attribute(slot.attrs, 'src');
      result += `<img${match ? slot.attrs.replace(match[0], `src="data:${asset.mime};base64,${asset.base64}"`) : slot.attrs}>`;
    } else {
      const text = new TextDecoder().decode(
        Uint8Array.from(atob(asset.base64), (char) => char.charCodeAt(0))
      );
      const tag = slot.kind === 'script' ? 'script' : 'style';
      const source = attribute(slot.attrs, 'src');
      const attrs = slot.kind === 'script' && source ? slot.attrs.replace(source[0], '') : '';
      result += `<${tag}${attrs}>${text.replace(new RegExp(`</${tag}`, 'gi'), `<\\/${tag}`)}</${tag}>`;
    }
  }
  return result + html.slice(cursor);
}
