import path from 'node:path';
import { app } from 'electron';
import { fitDataUrl } from '../services/pairImageEncoding';
import {
  createPairImagePort,
  type PairImagePort,
  resolveSessionImageReference,
  type SessionImageSource,
} from '../services/pairImages';
import { readPairSessionMessages } from '../services/pairSessionHistory';
import { codeFileContext } from './pairFiles';

/** 手机看会话里的图片：单张大图 ≤700K 字符、长边 ≤2048（手机单帧 <1MB） */
const SESSION_IMAGE_MAX_CHARS = 700_000;
const SESSION_IMAGE_MAX_EDGE = 2048;

/**
 * 根仍来自权威记录（项目/工作树/浏览器目录），手机只提供会话 id 与工作区相对路径。
 * 这里不放宽任何边界：越界、非图片扩展名、超大文件都由服务层拒绝。
 */
export function createPairImagesPort(): PairImagePort {
  return createPairImagePort({
    lookup: (sessionId): SessionImageSource | null => {
      const context = codeFileContext(sessionId);
      return context ? { root: context.root, stamp: context.stamp } : null;
    },
    resolveReferencedFile: async (sessionId, toolCallId) => {
      const before = codeFileContext(sessionId);
      if (!before) return null;
      const messages = await readPairSessionMessages(
        path.join(app.getPath('userData'), 'agent', 'sessions'),
        before.conversation.sessionFile
      );
      if (codeFileContext(sessionId)?.stamp !== before.stamp) return null;
      return resolveSessionImageReference(before.root, messages, toolCallId);
    },
    encode: (data, mime) => fitDataUrl(data, mime, SESSION_IMAGE_MAX_CHARS, SESSION_IMAGE_MAX_EDGE),
  });
}
