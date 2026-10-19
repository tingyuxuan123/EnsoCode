import type { ReadRequest } from './reading';

export const FIND_PAGE_REF_SOURCE = `const findRef = (ref, root = document) => {
  const own = root.querySelector('[data-enso-ref=' + JSON.stringify(ref) + ']');
  if (own) return own;
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) { const found = findRef(ref, el.shadowRoot); if (found) return found; }
    if (el.tagName === 'IFRAME') { try { if (el.contentDocument) { const found = findRef(ref, el.contentDocument); if (found) return found; } } catch {} }
  }
  return null;
};`;

export function pageReadScript(request: ReadRequest, snapshotId: string): string {
  return `(() => {
    ${FIND_PAGE_REF_SOURCE}
    const request = ${JSON.stringify(request)};
    const snapshotId = ${JSON.stringify(snapshotId)};
    const entries = [], words = [], diagnostics = [];
    let count = 0, length = 0, scanned = 0, truncated = false;
    const visible = (el) => {
      if (el.closest('[aria-hidden="true"],[inert],script,style,noscript,template')) return false;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (request.scope === 'document' || (r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth));
    };
    const walk = (root) => {
      for (const node of Array.from(root.childNodes || [])) {
        if (++scanned > 30000 || length >= 500000 || entries.length >= 5000) { truncated = true; return; }
        if (node.nodeType === 3) {
          const text = (node.textContent || '').replace(/\\s+/g, ' ').trim();
          const parent = node.parentElement;
          if (text && parent && visible(parent) && !parent.closest('textarea,input,[contenteditable="true"]')) { words.push(text.slice(0, 500000 - length)); length += text.length + 1; }
          continue;
        }
        if (node.nodeType !== 1) continue;
        const el = node;
        const tag = el.tagName.toLowerCase();
        if (/^(script|style|noscript|template)$/.test(tag) || el.id === 'enso-browser-lock-overlay' || el.id === 'enso-design-mode-root') continue;
        if (visible(el) && !/^(hidden|file)$/.test(el.type || '') && el.matches('a,button,input,select,textarea,summary,[role],[tabindex],[contenteditable="true"],[onclick]')) {
          let role = el.getAttribute('role') || ({ a: 'link', button: 'button', select: 'combobox', textarea: 'textbox', summary: 'button' }[tag]) || 'generic';
          if (tag === 'input') role = /^(checkbox|radio)$/.test(el.type) ? el.type : /^(button|submit|reset)$/.test(el.type) ? 'button' : 'textbox';
          const name = (el.getAttribute('aria-label') || (el.labels ? Array.from(el.labels).map((label) => label.textContent || '').join(' ') : '') || el.getAttribute('placeholder') || el.getAttribute('alt') || el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 500);
          const ref = 'e' + snapshotId + '_' + (++count);
          el.setAttribute('data-enso-ref', ref);
          const kind = tag === 'select' ? 'select' : /^(textbox|searchbox|spinbutton)$/.test(role) || el.isContentEditable ? 'fill' : 'click';
          const entry = { ref, role, name, depth: 0, kind };
          if (tag === 'input' && el.type !== 'password' && el.type !== 'file') entry.value = /^(checkbox|radio)$/.test(el.type) ? (el.checked ? 'checked' : '') : (el.value || '').slice(0, 200);
          entries.push(entry);
        }
        walk(el);
        if (el.shadowRoot) walk(el.shadowRoot);
        if (tag === 'iframe') {
          try { if (el.contentDocument?.body) walk(el.contentDocument.body); else diagnostics.push('Frame content unavailable (cross-origin or not loaded)'); }
          catch { diagnostics.push('Cross-origin frame skipped'); }
        }
      }
    };
    const root = request.ref ? findRef(request.ref) : document.body;
    if (!root) return { entries: [], text: '', diagnostics: ['Element ref is stale or document is not ready'], truncated: false };
    walk(root);
    return { entries, text: words.join(' ').slice(0, 500000), diagnostics: diagnostics.slice(0, 50), truncated };
  })()`;
}
