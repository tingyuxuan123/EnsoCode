import { fitDataUrl } from '../services/bots/mediaImage';
import {
  createPairImagePort,
  type PairImagePort,
  type SessionImageSource,
} from '../services/pairImages';
import { codeFileContext } from './pairFiles';

/** 手机看会话里的图片：单张大图 ≤700K 字符、长边 ≤2048，和 Bot 产物同一口径（手机单帧 <1MB） */
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
    encode: (data, mime) => fitDataUrl(data, mime, SESSION_IMAGE_MAX_CHARS, SESSION_IMAGE_MAX_EDGE),
  });
}
