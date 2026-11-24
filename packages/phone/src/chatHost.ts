import type { ChatHost } from '@/components/chat/chatHost';
import { toWorkspaceRelPath } from './localImageRel';
import type { SessionImageLoad, SessionImageTarget } from './sessionImagePort';

/**
 * 会话图片：手机没有 local-image://，把绝对路径换成工作区相对路径交给 host 读。
 */
export function phoneChatHost(input: {
  sessionId: string | null;
  deviceReadOnly?: boolean;
  cwd?: string;
  readImage?: (target: SessionImageTarget) => Promise<SessionImageLoad>;
  invalidateImage?: (target: SessionImageTarget) => void;
}): ChatHost {
  const readImage = input.readImage;
  const invalidateImage = input.invalidateImage;
  const cwd = input.cwd;
  return {
    sessionId: input.sessionId,
    canRewind: !input.deviceReadOnly,
    canRetry: !input.deviceReadOnly,
    canFork: false,
    ...(readImage
      ? {
          // 会话 + 执行目录：两者任一变化，同一相对路径都可能指向别的文件
          localImageScope: [input.sessionId ?? '', cwd ?? ''].join('|'),
          readLocalImage: async (path: string, toolCallId?: string) => {
            const rel = toWorkspaceRelPath(path, cwd);
            const target = rel
              ? ({ kind: 'workspace', rel } as const)
              : toolCallId
                ? ({ kind: 'tool-call', id: toolCallId } as const)
                : null;
            if (!target) return { ok: false as const, error: 'outside' };
            const result = await readImage(target);
            return 'dataUrl' in result
              ? { ok: true as const, dataUrl: result.dataUrl }
              : { ok: false as const, error: result.error };
          },
        }
      : {}),
    ...(invalidateImage
      ? {
          invalidateLocalImage: (path: string, toolCallId?: string) => {
            const rel = toWorkspaceRelPath(path, cwd);
            if (rel) invalidateImage({ kind: 'workspace', rel });
            else if (toolCallId) invalidateImage({ kind: 'tool-call', id: toolCallId });
          },
        }
      : {}),
  };
}
