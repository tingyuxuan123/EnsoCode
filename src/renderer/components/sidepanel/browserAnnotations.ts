import type { UiElementRect } from '@shared/browser/designMode';
import type { AttachedImage } from '@shared/types/agent';
import type { UiElementMentionCandidate } from '@shared/types/mentions';
import { useSyncExternalStore } from 'react';

/**
 * 内置浏览器「多点标注」清单：单选沿用直接插入 Composer 的老路，
 * 多点模式下先攒在清单里逐条写备注，最后一次性合进当前 Composer。
 * 队列按 会话 + tab + 页面 建键，侧栏/多窗口各自看见自己的清单，不会串会话。
 */

/** 清单上限：再多说明用户不是在做标注，别继续堆内存和大图 */
export const BROWSER_ANNOTATION_MAX = 20;

export type BrowserAnnotationKind = 'element' | 'region';

export interface BrowserAnnotationScope {
  conversationId: string;
  tabId: string;
  url: string;
}

export interface BrowserAnnotationInput extends BrowserAnnotationScope {
  kind: BrowserAnnotationKind;
  /** 页面给的标签/路径/文本，已按选区格式归一化 */
  label: string;
  path: string;
  text: string;
  image?: AttachedImage;
  rect?: UiElementRect;
}

export interface BrowserAnnotation extends BrowserAnnotationInput {
  id: string;
  /** 用户为这一条写的备注，原样保存（空串表示还没写） */
  note: string;
  createdAt: number;
}

/** 空清单的共享引用：useSyncExternalStore 要求同一状态下返回同一对象 */
const EMPTY_LIST: BrowserAnnotation[] = [];
const store = new Map<string, BrowserAnnotation[]>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

export function annotationScopeKey(scope: BrowserAnnotationScope): string {
  return `${scope.conversationId}\u0000${scope.tabId}\u0000${scope.url}`;
}

/** 同一 key 返回同一个数组引用，供 useSyncExternalStore 比较 */
export function annotationsFor(key: string): BrowserAnnotation[] {
  return store.get(key) ?? EMPTY_LIST;
}

export function subscribeAnnotations(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function nextId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `anno-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function addAnnotation(
  input: BrowserAnnotationInput,
  options: { id?: string; now?: number } = {}
): BrowserAnnotation | null {
  const key = annotationScopeKey(input);
  const current = annotationsFor(key);
  if (current.length >= BROWSER_ANNOTATION_MAX) return null;
  const entry: BrowserAnnotation = {
    ...input,
    id: options.id ?? nextId(),
    note: '',
    createdAt: options.now ?? Date.now(),
  };
  store.set(key, [...current, entry]);
  emit();
  return entry;
}

export function updateAnnotationNote(key: string, id: string, note: string): void {
  const current = annotationsFor(key);
  if (!current.some((entry) => entry.id === id && entry.note !== note)) return;
  store.set(
    key,
    current.map((entry) => (entry.id === id ? { ...entry, note } : entry))
  );
  emit();
}

export function removeAnnotation(key: string, id: string): void {
  const current = annotationsFor(key);
  if (!current.some((entry) => entry.id === id)) return;
  const next = current.filter((entry) => entry.id !== id);
  if (next.length === 0) store.delete(key);
  else store.set(key, next);
  emit();
}

export function clearAnnotations(key: string): void {
  if (!store.delete(key)) return;
  emit();
}

/**
 * 同一 tab 换了页面：旧页面的圈选连截图一起作废，
 * 避免把上一页的备注当成当前页位置发给 Agent；同会话其它 tab / 其它会话不受影响。
 */
export function pruneAnnotations(scope: BrowserAnnotationScope): void {
  if (!scope.url) return;
  const currentKey = annotationScopeKey(scope);
  const prefix = `${scope.conversationId}\u0000${scope.tabId}\u0000`;
  let changed = false;
  for (const key of [...store.keys()]) {
    if (key === currentKey || !key.startsWith(prefix)) continue;
    store.delete(key);
    changed = true;
  }
  if (changed) emit();
}

export interface ComposerAnnotationInsert {
  candidate: UiElementMentionCandidate;
  image?: AttachedImage;
  note: string;
}

/** 清单条目 → 一次 Composer 插入：位置引用 + 备注 + 截图 */
export function annotationMentionInsert(entry: BrowserAnnotation): ComposerAnnotationInsert {
  let page = '';
  try {
    const url = new URL(entry.url);
    if (url.protocol === 'https:' || url.protocol === 'http:')
      page = `${url.origin}${url.pathname}`;
  } catch {
    // Internal blank pages need no URL in the prompt.
  }
  const rect = entry.rect;
  const location = [
    `Browser ${entry.kind} · tab ${entry.tabId}`,
    page ? `page ${page}` : '',
    rect
      ? `bounds ${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}×${Math.round(rect.height)} CSS px`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    candidate: {
      kind: 'ui-element',
      id: entry.id,
      label: entry.label,
      path: entry.path,
      text: entry.text,
      imageId: `img-${entry.id}`,
    },
    ...(entry.image ? { image: entry.image } : {}),
    note: [location, entry.note.trim()].filter(Boolean).join('\n'),
  };
}

export function useBrowserAnnotations(scope: BrowserAnnotationScope): BrowserAnnotation[] {
  const key = annotationScopeKey(scope);
  return useSyncExternalStore(subscribeAnnotations, () => annotationsFor(key));
}

export function resetAnnotationsForTest(): void {
  store.clear();
  listeners.clear();
}
