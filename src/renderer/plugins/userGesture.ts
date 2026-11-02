/** Read at call receipt, never trust a flag supplied by the opaque plugin frame. */
export function hasActivePluginGesture(): boolean {
  return typeof navigator !== 'undefined' && navigator.userActivation?.isActive === true;
}

/** Ancestor activation alone may originate in an unrelated input in the main UI. */
export function hasPluginViewGesture(
  frame: unknown,
  activeElement: unknown,
  isActive: boolean
): boolean {
  return frame != null && activeElement === frame && isActive;
}
