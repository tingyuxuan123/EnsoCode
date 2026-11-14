import type { ChatHost } from '@/components/chat/chatHost';
import { toWorkspaceRelPath } from './localImageRel';
import type { SessionImageLoad } from './sessionImagePort';

/**
 * 成员会话标 botSession：时间线按桌面一样把 Main 注入的群消息 / 委派 / 引用拆成卡片。
 * 会话图片：手机没有 local-image://，把绝对路径换成工作区相对路径交给 host 读。
 */
export function phoneChatHost(input: {
  sessionId: string | null;
  bot?: object;
  deviceReadOnly?: boolean;
  cwd?: string;
  readImage?: (rel: string) => Promise<SessionImageLoad>;
  invalidateImage?: (rel: string) => void;
}): ChatHost {
  const readImage = input.readImage;
  const invalidateImage = input.invalidateImage;
  const cwd = input.cwd;
  return {
    sessionId: input.sessionId,
    canRewind: !input.bot && !input.deviceReadOnly,
    canRetry: !input.bot && !input.deviceReadOnly,
    canFork: false,
    ...(input.bot ? { botSession: true } : {}),
    ...(readImage
      ? {
          // 会话 + 执行目录：两者任一变化，同一相对路径都可能指向别的文件
          localImageScope: [input.sessionId ?? '', cwd ?? ''].join('|'),
          readLocalImage: async (path: string) => {
            const rel = toWorkspaceRelPath(path, cwd);
            if (!rel) return { ok: false as const, error: 'outside' };
            const result = await readImage(rel);
            return 'dataUrl' in result
              ? { ok: true as const, dataUrl: result.dataUrl }
              : { ok: false as const, error: result.error };
          },
        }
      : {}),
    ...(invalidateImage
      ? {
          invalidateLocalImage: (path: string) => {
            const rel = toWorkspaceRelPath(path, cwd);
            if (rel) invalidateImage(rel);
          },
        }
      : {}),
  };
}
