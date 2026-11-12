/**
 * 全窗口压暗浮层（看图放大等）的登记表。
 *
 * Windows 按钮底板透明，遮罩由 renderer 绘制；原生按钮的符号仍画在遮罩上方。
 * `useNativeWindowControls` 用这里的遮罩色估算对比度，让符号在明显压暗时也可见。
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
