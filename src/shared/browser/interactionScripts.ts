import { FIND_PAGE_REF_SOURCE } from './readingScripts';

export function pagePrepareInputScript(ref?: string, editable = false): string {
  return `(() => {
    ${FIND_PAGE_REF_SOURCE}
    const el = ${ref ? `findRef(${JSON.stringify(ref)})` : 'document.activeElement'};
    if (!el || !el.isConnected) return 'stale';
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const overlay = document.getElementById('enso-browser-lock-overlay');
    const previous = overlay?.style.display;
    if (overlay) overlay.style.display = 'none';
    try {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || el.matches(':disabled,[aria-disabled="true"]')) return 'covered';
      const root = el.getRootNode();
      const hit = (root.elementFromPoint ? root : el.ownerDocument).elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      if (!(hit === el || el.contains(hit))) return 'covered';
      if (${editable} && !(el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !/^(file|hidden|checkbox|radio|button|submit|reset|image)$/.test(el.type)))) return 'not-editable';
      if (${editable} && el.readOnly) return 'not-editable';
      el.focus();
      let x = r.x + r.width / 2, y = r.y + r.height / 2;
      let win = el.ownerDocument.defaultView;
      while (win && win !== window && win.frameElement) { const frame = win.frameElement.getBoundingClientRect(); x += frame.x; y += frame.y; win = win.parent; }
      return { x, y, checked: typeof el.checked === 'boolean' ? el.checked : el.getAttribute('aria-checked'), tag: el.tagName, type: el.type || '', value: el.type === 'password' ? undefined : el.value };
    } finally { if (overlay) overlay.style.display = previous; }
  })()`;
}

export function pageScrollIntoViewScript(ref: string): string {
  return `(() => { ${FIND_PAGE_REF_SOURCE} const el = findRef(${JSON.stringify(ref)}); if (!el) return 'stale'; el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }); return 'ok'; })()`;
}

export function pageCheckedScript(ref: string): string {
  return `(() => { ${FIND_PAGE_REF_SOURCE} const el = findRef(${JSON.stringify(ref)}); if (!el) return 'stale'; return typeof el.checked === 'boolean' ? el.checked : el.getAttribute('aria-checked') === 'true' ? true : el.getAttribute('aria-checked') === 'false' ? false : 'not-checkable'; })()`;
}

export interface BrowserWaitRequest {
  kind: 'text' | 'element' | 'url';
  text?: string;
  ref?: string;
  state: 'present' | 'absent' | 'visible' | 'hidden';
  timeoutMs: number;
}
export function parseBrowserWait(raw: unknown): BrowserWaitRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('wait params must be an object');
  const p = raw as Record<string, unknown>;
  if (p.kind !== 'text' && p.kind !== 'element' && p.kind !== 'url')
    throw new Error('Invalid wait kind');
  if (
    p.kind === 'element'
      ? typeof p.ref !== 'string' || !p.ref
      : typeof p.text !== 'string' || !p.text
  )
    throw new Error('wait requires text or ref');
  const state = p.state ?? 'present';
  if (state !== 'present' && state !== 'absent' && state !== 'visible' && state !== 'hidden')
    throw new Error('Invalid wait state');
  const timeoutMs = p.timeoutMs ?? 10000;
  if (
    typeof timeoutMs !== 'number' ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30000
  )
    throw new Error('wait timeoutMs must be between 1 and 30000');
  return {
    kind: p.kind,
    ...(typeof p.ref === 'string' ? { ref: p.ref } : {}),
    ...(typeof p.text === 'string' ? { text: p.text } : {}),
    state,
    timeoutMs,
  };
}
export function pageWaitScript(request: BrowserWaitRequest): string {
  return `(() => {
    ${FIND_PAGE_REF_SOURCE}
    const p = ${JSON.stringify(request)};
    let matched;
    if (p.kind === 'url') matched = location.href.includes(p.text);
    else if (p.kind === 'text') matched = (document.body?.innerText || '').includes(p.text);
    else { const el = findRef(p.ref); matched = Boolean(el?.isConnected); if (matched && (p.state === 'visible' || p.state === 'hidden')) { const r = el.getBoundingClientRect(); const style = getComputedStyle(el); matched = r.width > 0 && r.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'; } }
    return p.state === 'absent' || p.state === 'hidden' ? !matched : matched;
  })()`;
}

export function parseBrowserKey(key: string): { keyCode: string; modifiers: string[] } {
  const pieces = key.split('+');
  const last = pieces.pop();
  if (!last) throw new Error('Invalid key');
  const aliases: Record<string, string> = {
    ctrl: 'control',
    control: 'control',
    cmd: 'meta',
    command: 'meta',
    meta: 'meta',
    alt: 'alt',
    option: 'alt',
    shift: 'shift',
  };
  const modifiers = pieces.map((part) => aliases[part.toLowerCase()]);
  if (modifiers.some((part) => !part)) throw new Error('Invalid key modifier');
  const keys: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: 'Escape',
    Esc: 'Escape',
    Space: 'Space',
    ' ': 'Space',
    Return: 'Enter',
    Delete: 'Delete',
  };
  return { keyCode: keys[last] ?? last, modifiers };
}
