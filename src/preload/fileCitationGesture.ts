import type { FileCitationGesture } from '@shared/fileCitationGesture';

/** Installed in the isolated preload, not exposed on window. A grant exists only during the actual DOM event. */
export function createFileCitationGestureGate(view: Window) {
  let grant: { event: Event; action: FileCitationGesture; key: string } | undefined;
  const capture = (event: Event) => {
    grant = undefined;
    if (!event.isTrusted) return;
    const control = event
      .composedPath()
      .find((node) => node instanceof Element && node.hasAttribute('data-file-citation-action'));
    if (!(control instanceof Element)) return;
    const action = control.getAttribute('data-file-citation-action');
    const key = control.getAttribute('data-file-citation-key');
    if (!key || (action !== 'open' && action !== 'save')) return;
    if (event instanceof MouseEvent) {
      if (event.button !== 0 || (action === 'save' && control.tagName !== 'BUTTON')) return;
    } else if (event instanceof KeyboardEvent) {
      if (event.repeat || event.isComposing) return;
      if (action === 'open' && event.key !== 'Enter') return;
      if (
        action === 'save' &&
        !((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's')
      )
        return;
    } else return;
    grant = { event, action, key };
  };
  view.addEventListener('click', capture, true);
  view.addEventListener('keydown', capture, true);
  return (action: FileCitationGesture, key: string): boolean => {
    if (
      !grant ||
      grant.event.eventPhase === Event.NONE ||
      grant.action !== action ||
      grant.key !== key
    )
      return false;
    grant = undefined;
    return true;
  };
}
