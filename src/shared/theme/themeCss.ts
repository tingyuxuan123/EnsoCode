const ESCAPE = /\\(?:([0-9a-fA-F]{1,6})[ \t\n\r\f]?|(\r\n|[\n\r\f])|([\s\S]))/g;
function unescapeCss(css: string): string {
  return css.replace(ESCAPE, (_, hex: string | undefined, newline: string | undefined, ch) => {
    if (newline) return '';
    if (!hex) return ch;
    const code = Number.parseInt(hex, 16);
    return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
      ? '\uFFFD'
      : String.fromCodePoint(code);
  });
}
export function themeCssReferencesLocalImage(css: string): boolean {
  let text = unescapeCss(css);
  for (let i = 0; i < 8; i++) {
    const next = text.replace(/%([0-9a-fA-F]{2})/g, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16))
    );
    if (text === next) break;
    text = next;
  }
  return text
    .replace(/[\t\n\r]/g, '')
    .toLowerCase()
    .includes('local-image');
}
export function rewriteThemeCssUrls(
  css: string,
  cssPath: string,
  toUrl: (rel: string) => string
): string {
  return css.replace(
    /url\(\s*(?:"([^"\\\n]*)"|'([^'\\\n]*)'|([^)"'\s\\]*))\s*\)/gi,
    (token, double?: string, single?: string, bare?: string) => {
      const value = (double ?? single ?? bare ?? '').trim();
      if (!value || value.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(value)) return token;
      const hashAt = value.indexOf('#');
      const hash = hashAt < 0 ? '' : value.slice(hashAt).replaceAll('"', '%22');
      const path = (hashAt < 0 ? value : value.slice(0, hashAt)).split('?')[0];
      const stack = cssPath.split('/').slice(0, -1);
      for (const raw of path.split('/')) {
        let part: string;
        try {
          part = decodeURIComponent(raw);
        } catch {
          return token;
        }
        if (!part || part === '.') continue;
        if (part === '..') {
          if (stack.pop() === undefined) return token;
        } else {
          if (/[\\/\0]/.test(part)) return token;
          stack.push(part);
        }
      }
      return stack.length ? `url("${toUrl(stack.join('/'))}${hash}")` : token;
    }
  );
}
