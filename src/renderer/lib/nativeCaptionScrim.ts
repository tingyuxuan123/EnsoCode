/**
 * 全窗口压暗浮层（看图放大等）的登记表。
 *
 * Windows 的原生窗口按钮画在 renderer 之上，renderer 里再深的遮罩也盖不住右上角那
 * 一块；标题栏配色只能经 `window:set-title-bar-appearance` 主动同步。这里记下当前
 * 压在标题栏上的那层遮罩，`useNativeWindowControls` 采样时把它叠进去，右上角才不会
 * 在压暗的界面上留一块亮底。
 *
 * 用栈而不是计数器：浮层可以嵌套，最上层那层的颜色才是标题栏实际看到的。
 */
const scrims: string[] = [];
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** 当前压在标题栏上的一层遮罩（CSS 颜色，可带 alpha）；没有则为 null。 */
export function getNativeCaptionScrim(): string | null {
  return scrims.length > 0 ? scrims[scrims.length - 1] : null;
}

export function acquireNativeCaptionScrim(color: string): void {
  scrims.push(color);
  notify();
}

/** 按登记顺序出栈；同色多层各自出栈，不会一次清空。 */
export function releaseNativeCaptionScrim(color: string): void {
  const index = scrims.lastIndexOf(color);
  if (index === -1) return;
  scrims.splice(index, 1);
  notify();
}

export function subscribeNativeCaptionScrim(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetNativeCaptionScrim(): void {
  scrims.length = 0;
  listeners.clear();
}
