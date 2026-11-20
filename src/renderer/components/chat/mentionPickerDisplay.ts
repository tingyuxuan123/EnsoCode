import type { ChatMentionCandidate } from '@shared/types/mentions';
import { formatRelativeTime } from '@/lib/time';

export interface ChatMentionMeta {
  createdAt?: number;
  projectName?: string;
  sameProject?: boolean;
}

const SESSION_FILE_TIMESTAMP =
  /(?:^|[\\/])(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z(?:_|\.|$)/;

/** 从标准 pi 会话文件名（`YYYY-MM-DDTHH-mm-ss-sssZ_<id>.jsonl`）解析时间戳。 */
export function parseSessionFileTimestamp(sessionFile: string): number | undefined {
  const match = SESSION_FILE_TIMESTAMP.exec(sessionFile);
  if (!match) return undefined;
  const [, date, hour, minute, second, ms = '000'] = match;
  const parsed = Date.parse(`${date}T${hour}:${minute}:${second}.${ms}Z`);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * 格式化过去会话的辅助信息：优先显示跨项目归属与相对时间，
 * 无元数据时尝试从文件名提取时间，避免在界面暴露原始 UUID jsonl 路径。
 */
export function formatChatMentionMeta({
  candidate,
  meta,
  locale,
  now,
}: {
  candidate: ChatMentionCandidate;
  meta?: ChatMentionMeta;
  locale: string;
  now?: number;
}): string | undefined {
  const timestamp = meta?.createdAt ?? parseSessionFileTimestamp(candidate.sessionFile);
  const timeLabel =
    timestamp !== undefined ? formatRelativeTime(timestamp, locale || 'en', now) : undefined;
  if (meta?.projectName && meta.sameProject === false) {
    return timeLabel ? `${meta.projectName} · ${timeLabel}` : meta.projectName;
  }
  return timeLabel;
}

/**
 * 提取文件/目录候选项的父目录提示：
 * 根目录项与名称完全相同时不重复展示第二行；嵌套项去掉末尾重复的文件名。
 */
export function mentionFileParentPath(
  label: string,
  pathLabel: string | undefined,
  relativePath: string
): string | undefined {
  const raw = (pathLabel ?? relativePath).replace(/\\/g, '/').replace(/\/+$/, '');
  if (!raw || raw === label) return undefined;
  const suffix = `/${label}`;
  if (raw.endsWith(suffix)) {
    const parent = raw.slice(0, -suffix.length);
    return parent || undefined;
  }
  return raw;
}
