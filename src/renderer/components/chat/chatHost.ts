import { createContext, useContext } from 'react';

/**
 * 时间线的宿主上下文：告诉 TimelineRow 里少数「越过 props 直接读 store」的组件
 * 当前展示的是谁的会话、能做什么。
 * - 本机 ChatView 不提供（null）：保持现行为，直接读 useSessionsStore。
 * - 远程节点视图提供 { sessionId, canRewind:false, canRetry:false }：
 *   回退/重试协议不支持，直接不渲染入口；计时 key 用远程会话 id 而非本机 active 会话。
 */
/** 远程宿主读本地图片的返回：成功给 data URL，失败给机器可读错误码（由渲染层翻文案） */
export type LocalImageLoad = { ok: true; dataUrl: string } | { ok: false; error: string };

export interface ChatHost {
  sessionId: string | null;
  canRewind: boolean;
  canRetry: boolean;
  /** 缺省跟随 canRewind；手机 PWA 开回退但不开分叉 */
  canFork?: boolean;
  /**
   * 会话里图片的远程读取（手机 PWA）：工作区图片换成相对路径；目录外 read 图片
   * 只带时间线里的工具调用 id，由 Main 从权威会话记录反查路径。
   * 缺省 = 本机 Electron，继续用 `local-image://` 特权协议。
   */
  readLocalImage?: (path: string, toolCallId?: string) => Promise<LocalImageLoad>;
  /**
   * 让宿主丢弃这张图的缓存（手机 PWA）：<img> 解码失败、或同一路径的文件被覆盖时调用，
   * 之后的重试必须真的重新取图，而不是再拿回同一份坏/旧像素。
   */
  invalidateLocalImage?: (path: string, toolCallId?: string) => void;
  /**
   * 远程图片的本地资源代次（会话 id + 执行目录等已有信号）。变了就说明同一相对路径
   * 指向的文件已经换成另一个工作树/会话资源，必须重新加载，不能沿用已挂载的旧像素。
   */
  localImageScope?: string;
}

export const ChatHostContext = createContext<ChatHost | null>(null);
/** 正文宿主的真实会话，不依赖全局正在显示的主聊天；侧栏也使用同一标识。 */
export const ChatSessionContext = createContext<string | null>(null);

export function useChatHost(): ChatHost | null {
  return useContext(ChatHostContext);
}
