type Rect = { left: number; top: number; width: number; height: number };
type Size = { width: number; height: number };
export function previewPoint(
  x: number,
  y: number,
  rect: Rect,
  frame: Size
): { x: number; y: number } | null {
  if (
    ![x, y, rect.left, rect.top, rect.width, rect.height, frame.width, frame.height].every(
      Number.isFinite
    ) ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    frame.width <= 0 ||
    frame.height <= 0 ||
    x < rect.left ||
    x > rect.left + rect.width ||
    y < rect.top ||
    y > rect.top + rect.height
  )
    return null;
  return {
    x: Math.min(
      frame.width - 1,
      Math.max(0, Math.floor(((x - rect.left) * frame.width) / rect.width))
    ),
    y: Math.min(
      frame.height - 1,
      Math.max(0, Math.floor(((y - rect.top) * frame.height) / rect.height))
    ),
  };
}
export function previewSwipe(
  from: { x: number; y: number },
  to: { x: number; y: number },
  rect: Rect,
  frame: Size
): { deltaX: number; deltaY: number } | null {
  if (Math.hypot(from.x - to.x, from.y - to.y) < 10 || rect.width <= 0 || rect.height <= 0)
    return null;
  const clamp = (n: number) => Math.max(-2000, Math.min(2000, Math.round(n)));
  return {
    deltaX: clamp(((from.x - to.x) * frame.width) / rect.width),
    deltaY: clamp(((from.y - to.y) * frame.height) / rect.height),
  };
}
