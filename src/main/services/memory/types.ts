import type { NoteStatus, VaultPreset } from '@shared/memory/constants';
import { isBotChatId, isBotId } from '@shared/types/bot';

export const GLOBAL_SPACE = 'global';
const PROJECT_SPACE_PREFIX = 'proj:';
const BOT_SPACE_PREFIX = 'bot:';
const CHAT_SPACE_PREFIX = 'chat:';

const SAFE_PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export class MemoryValidationError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'MemoryValidationError';
  }
}

export function projectSpaceId(projectId: string): string {
  if (!SAFE_PROJECT_ID_RE.test(projectId)) {
    throw new MemoryValidationError('invalid_space', 'invalid project id');
  }
  return `${PROJECT_SPACE_PREFIX}${projectId}`;
}

export function botSpaceId(botId: string): string {
  if (!isBotId(botId)) throw new MemoryValidationError('invalid_space', 'invalid bot id');
  return `${BOT_SPACE_PREFIX}${botId}`;
}

export function chatSpaceId(chatId: string): string {
  if (!isBotChatId(chatId)) throw new MemoryValidationError('invalid_space', 'invalid chat id');
  return `${CHAT_SPACE_PREFIX}${chatId}`;
}

export type ParsedSpaceId = { kind: 'global' } | { kind: 'project' | 'bot' | 'chat'; id: string };

export function parseSpaceId(value: string): ParsedSpaceId | undefined {
  if (value === GLOBAL_SPACE) return { kind: 'global' };
  if (value.startsWith(PROJECT_SPACE_PREFIX)) {
    const id = value.slice(PROJECT_SPACE_PREFIX.length);
    return SAFE_PROJECT_ID_RE.test(id) ? { kind: 'project', id } : undefined;
  }
  if (value.startsWith(BOT_SPACE_PREFIX)) {
    const id = value.slice(BOT_SPACE_PREFIX.length);
    return isBotId(id) ? { kind: 'bot', id } : undefined;
  }
  if (value.startsWith(CHAT_SPACE_PREFIX)) {
    const id = value.slice(CHAT_SPACE_PREFIX.length);
    return isBotChatId(id) ? { kind: 'chat', id } : undefined;
  }
  return undefined;
}

export function isSpaceId(value: string): boolean {
  return parseSpaceId(value) !== undefined;
}

export interface ResolvedVaultSpace {
  spaceId: string;
  rootPath: string;
  isExternal: boolean;
  preset: VaultPreset;
}

export interface IndexedNoteRow {
  spaceId: string;
  relPath: string;
  slug: string;
  title: string;
  description: string;
  type: string;
  status: NoteStatus;
  tags: string[];
  resource: string | null;
  generatedBy: string | null;
  generatedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  staleAfter: string | null;
  sources: string[];
  supersededBy: string | null;
  isRaw: boolean;
  isArchived: boolean;
  contentHash: string;
  mtimeMs: number;
  sizeBytes: number;
  lineCount: number;
  bodyPreview: string;
  updatedAt: string;
}

export interface CompleteOptions {
  maxTokens?: number;
  stage?: string;
  signal?: AbortSignal;
}

export type Complete = (
  systemPrompt: string,
  userText: string,
  options?: CompleteOptions
) => Promise<string>;

export interface TranscriptMessage {
  role: 'user' | 'assistant';
  text: string;
  entryId?: string;
}
