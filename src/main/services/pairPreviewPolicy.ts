export const PAIR_PREVIEW_STATIC_ORIGIN = 'http://enso-preview.invalid';

/** CSP is defense in depth for frames/workers/forms and networking not exposed as navigations. */
export function pairPreviewCsp(entry: string): string {
  const url = new URL(entry);
  const origin = url.origin;
  const websocket = origin.replace(/^http:/, 'ws:');
  // Chromium rejects IPv6 literal CSP host-sources. webRequest + the isolated proxy
  // still enforce exact selected origin/port when CSP must use the ws scheme.
  const connect = url.hostname === '[::1]' ? "'self' ws:" : `${origin} ${websocket}`;
  return `sandbox allow-scripts allow-same-origin allow-forms; default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src ${connect}; frame-src 'none'; child-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`;
}

export interface PairPreviewNetworkPolicy {
  entryUrl: string;
  allowsRequest(raw: string, resourceType?: string): boolean;
  allowsNavigation(raw: string): boolean;
}

/** Inspect BEFORE URL normalisation, which would otherwise erase dot segments. */
export function isPairPreviewPathAllowed(path: string, server = false): boolean {
  if (!path.startsWith('/') || path.includes('\\') || hasControls(path)) return false;
  if (/%(?:2f|5c)/i.test(path)) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  // The Vue plugin's single virtual helper is not a filesystem path/Windows ADS.
  if (server && decoded === '/@id/__x00__plugin-vue:export-helper') return true;
  // No double decoding by an upstream dev server, encoded separators or Windows ADS.
  if (/[%\\:]/.test(decoded) || hasControls(decoded)) return false;
  const parts = decoded.toLowerCase().split('/');
  const viteDeps =
    server &&
    (decoded.toLowerCase().startsWith('/node_modules/.vite/deps/') ||
      decoded.toLowerCase().startsWith('/.vite/deps/'));
  return parts.every((part, index) => {
    if (!part) return true;
    if (part === '@fs' || part === '.git' || part === '.' || part === '..') return false;
    if (part.startsWith('.') && !(viteDeps && (index === 1 || index === 2) && part === '.vite'))
      return false;
    if (part === 'node_modules' && !(viteDeps && index === 1)) return false;
    if (/^(?:secrets?|credentials?)(?:[._-]|$)/.test(part)) return false;
    if (/^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(part)) return false;
    if (/(?:^|[.-])server\.[cm]?[jt]sx?$|\.config\.[cm]?[jt]s$/.test(part)) return false;
    if (
      /\.(?:pem|key|p12|pfx|crt|sqlite3?|db)$/.test(part) ||
      /^id_(?:rsa|ed25519|ecdsa)/.test(part)
    )
      return false;
    return true;
  });
}

/** Only parse the selected-origin Vite route; filesystem authority is checked separately in Main. */
export function pairPreviewFsPath(raw: string, selectedUrl: string): string | null {
  if (/[\s\\]/.test(raw) || hasControls(raw)) return null;
  const match =
    /^http:\/\/((?:127\.0\.0\.1|\[::1\])(?::[1-9]\d{0,4})?)(\/@fs\/[^?#]*)(?:[?#].*)?$/.exec(raw);
  if (!match || new URL(`http://${match[1]}`).origin !== new URL(selectedUrl).origin) return null;
  if (/%(?:2f|5c)/i.test(match[2])) return null;
  try {
    const decoded = decodeURIComponent(match[2].slice('/@fs/'.length));
    if (!decoded || /[%\\]/.test(decoded) || hasControls(decoded)) return null;
    if (decoded.split('/').some((part) => part === '.' || part === '..')) return null;
    // Vite strips the leading slash on Unix, but retains Windows' drive prefix.
    if (/^[A-Za-z]:\//.test(decoded)) return decoded;
    if (decoded.includes(':')) return null;
    return `/${decoded.replace(/^\/+/, '')}`;
  } catch {
    return null;
  }
}

export function createPairPreviewNetworkPolicy(
  kind: 'html' | 'server',
  entry: string
): PairPreviewNetworkPolicy {
  const server = kind === 'server';
  const entryUrl = server ? entry : `${PAIR_PREVIEW_STATIC_ORIGIN}${entry}`;
  const selected = parseNetworkUrl(entryUrl, server);
  if (
    selected?.url.protocol !== 'http:' ||
    (server
      ? !['127.0.0.1', '[::1]'].includes(selected.url.hostname)
      : selected.url.origin !== PAIR_PREVIEW_STATIC_ORIGIN)
  )
    throw new Error('Invalid preview origin');
  const origin = selected.url.origin;
  const allowsNavigation = (raw: string): boolean => {
    const parsed = parseNetworkUrl(raw, server);
    return !!parsed && parsed.url.protocol === 'http:' && parsed.url.origin === origin;
  };
  return {
    entryUrl: selected.url.href,
    allowsNavigation,
    allowsRequest(raw, resourceType) {
      if (['subFrame', 'serviceWorker', 'worker', 'sharedWorker'].includes(resourceType ?? ''))
        return false;
      if (resourceType && ['image', 'font', 'media'].includes(resourceType)) {
        if (raw.startsWith('data:')) return true;
        if (raw.startsWith(`blob:${origin}/`)) return true;
      }
      if (allowsNavigation(raw)) return true;
      if (!server) return false;
      const parsed = parseNetworkUrl(raw, true);
      return !!parsed && parsed.url.protocol === 'ws:' && parsed.url.host === selected.url.host;
    },
  };
}

function parseNetworkUrl(raw: string, server: boolean): { url: URL } | null {
  if (/[\s\\]/.test(raw) || hasControls(raw)) return null;
  const match = /^(http|ws):\/\/([^/?#]+)([^?#]*)/.exec(raw);
  if (!match || !isPairPreviewPathAllowed(match[3] || '/', server)) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password) return null;
    // Do not let URL's liberal IPv4 parser turn 127.1, octal or integer IPs into loopback.
    if (server && !/^(?:127\.0\.0\.1|\[::1\])(?::[1-9]\d{0,4})?$/.test(match[2])) return null;
    if (!server && match[2] !== 'enso-preview.invalid') return null;
    return { url };
  } catch {
    return null;
  }
}

function hasControls(value: string): boolean {
  return [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}
