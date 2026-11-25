/** Only appearance tokens cross the opaque iframe boundary; never arbitrary CSS, URLs or DOM data. */
export const PLUGIN_THEME_VARIABLES = [
  '--background',
  '--foreground',
  '--panel',
  '--shell',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--border',
  '--input',
  '--ring',
  '--brand',
  '--destructive',
  '--destructive-foreground',
  '--success',
  '--warning',
  '--radius',
  '--font-family-sans',
  '--font-family-mono',
  '--font-size-base',
] as const;
export interface PluginThemeSnapshot {
  theme: 'light' | 'dark';
  variables: Record<string, string>;
}
export function readPluginTheme(doc: Document): PluginThemeSnapshot {
  const style = doc.defaultView?.getComputedStyle(doc.documentElement);
  const variables: Record<string, string> = {};
  for (const name of PLUGIN_THEME_VARIABLES) {
    const raw = style?.getPropertyValue(name).trim() ?? '';
    const value = raw.replace(/\s+/g, ' ');
    if (!raw || raw.length > 512 || /[\\\p{Cc};{}<>]|url\s*\(|@import/iu.test(value)) continue;
    variables[name] = value;
  }
  return { theme: doc.documentElement.classList.contains('dark') ? 'dark' : 'light', variables };
}
export function observePluginTheme(
  doc: Document,
  push: (snapshot: PluginThemeSnapshot) => void
): () => void {
  const win = doc.defaultView;
  if (!win) return () => {};
  let frame: number | undefined;
  let disposed = false;
  let previous = JSON.stringify(readPluginTheme(doc));
  const schedule = () => {
    if (disposed || frame !== undefined) return;
    frame = win.requestAnimationFrame(() => {
      frame = undefined;
      if (disposed) return;
      const snapshot = readPluginTheme(doc);
      const serialized = JSON.stringify(snapshot);
      if (serialized === previous) return;
      previous = serialized;
      push(snapshot);
    });
  };
  const root = new win.MutationObserver(schedule);
  root.observe(doc.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style', 'data-light-palette', 'data-accent'],
  });
  const styles = new win.MutationObserver(schedule);
  styles.observe(doc.head, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['href', 'media', 'disabled'],
  });
  return () => {
    disposed = true;
    root.disconnect();
    styles.disconnect();
    if (frame !== undefined) win.cancelAnimationFrame(frame);
  };
}
