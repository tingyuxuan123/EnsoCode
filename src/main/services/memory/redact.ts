const REDACTED = '[REDACTED]';

/**
 * 写入前安全脱敏：会话正文里可能贴过密钥 / 口令，长期记忆以明文 Markdown 落盘（还可能同步到 Obsidian / Git），
 * 按「先整块、再已知前缀、再键值」顺序打码；键名保留以维持语义。
 */
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/g,
  /\bgh[opusr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bhf_[A-Za-z0-9]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
  /(\w+:\/\/[^\s/:@]+:)[^\s/@]+@/g,
];

const KV_PATTERN =
  /\b((?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|refresh[_-]?token|token|passwd|password|pwd|authorization|client[_-]?secret|private[_-]?key)["']?\s*[:=]\s*)("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[^\s"',;{}[\]]{6,})/gi;

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m, group?: string) =>
      typeof group === 'string' && m.includes('://') ? `${group}${REDACTED}@` : REDACTED
    );
  }
  out = out.replace(KV_PATTERN, (_m, key: string, value: string) => {
    const quote = value[0] === '"' || value[0] === "'" ? value[0] : '';
    return `${key}${quote}${REDACTED}${quote}`;
  });
  return out;
}

/** 容错 JSON 解析：剥离 <think> 块、Markdown 代码围栏和前后废话，提取最外层 JSON 对象。 */
export function looseParse(raw: string): unknown {
  const stripped = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?\s*([\s\S]*?)```/gi, '$1')
    .trim();
  if (!stripped) return null;
  try {
    return JSON.parse(stripped);
  } catch {}
  const firstObj = stripped.indexOf('{');
  const lastObj = stripped.lastIndexOf('}');
  if (firstObj >= 0 && lastObj > firstObj) {
    try {
      return JSON.parse(stripped.slice(firstObj, lastObj + 1));
    } catch {}
  }
  return null;
}
