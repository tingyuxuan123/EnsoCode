import type { SupportedLanguages } from '@pierre/diffs';

/**
 * `@pierre/diffs` 只按「最后一个扩展名」推断语言，`.env` 命中 `env → dotenv`，
 * 而 `.env.development` 会落到 `development` 从而退化成纯文本。这里显式把
 * `.env` 及 `.env.*` 归一到 dotenv（与 VS Code 的 `.env*` 关联一致）。
 *
 * 返回 undefined 表示不干预，交给库按文件名推断。
 */
export function fileLanguage(name: string): SupportedLanguages | undefined {
  const base = name.split(/[/\\]/).pop() ?? '';
  return base === '.env' || base.startsWith('.env.') ? 'dotenv' : undefined;
}
