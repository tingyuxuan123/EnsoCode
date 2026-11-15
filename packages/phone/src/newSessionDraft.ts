import type { AttachedImage } from '@enso/pair';

/** 新建会话页里还没发出去的输入：正文 + 已压缩好的图片 */
export interface NewSessionDraft {
  text: string;
  images: AttachedImage[];
}

export type NewSessionDraftAction =
  | { type: 'text'; text: string }
  | { type: 'add-images'; images: AttachedImage[] }
  | { type: 'remove-image'; index: number }
  /** 点关闭：草稿留着，下次进来还在 */
  | { type: 'close' }
  /** 已交给 onCreate 创建：清空，避免下次新会话带着上一次的输入 */
  | { type: 'create' };

export const EMPTY_DRAFT: NewSessionDraft = { text: '', images: [] };

export function newSessionDraft(
  state: NewSessionDraft,
  action: NewSessionDraftAction
): NewSessionDraft {
  switch (action.type) {
    case 'text':
      return { ...state, text: action.text };
    case 'add-images':
      return action.images.length > 0
        ? { ...state, images: [...state.images, ...action.images] }
        : state;
    case 'remove-image':
      return { ...state, images: state.images.filter((_, i) => i !== action.index) };
    case 'close':
      return state;
    case 'create':
      return EMPTY_DRAFT;
  }
}

/**
 * 附到 NewSessionRequest.draft 的内容：空白且无图时返回 undefined，
 * 让主进程/渲染层不会把「空草稿」当成一条待发消息种进输入框。
 */
export function draftRequest(
  draft: NewSessionDraft
): { text: string; images?: AttachedImage[] } | undefined {
  const text = draft.text.trim();
  if (!text && draft.images.length === 0) return undefined;
  return { text, ...(draft.images.length > 0 ? { images: draft.images } : {}) };
}
