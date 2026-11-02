import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { PairFileTarget } from '@enso/pair';
import type { ProjectedMessage } from '@shared/types/agent';
import { app } from 'electron';
import { turnBounds, turnOfReply } from '../services/bots/artifacts';
import { readBotSessionMessages } from '../services/bots/sessionMessages';
import { pickBrowserFileRoot } from '../services/browserFileRoot';
import type {
  PairPreviewBrowserFactory,
  PairPreviewPort,
  PairPreviewSource,
} from '../services/pairPreview';
import { createPairPreviewPort } from '../services/pairPreview';
import { getSourceAuthorityRegistry } from './agent';
import { botModeEnabled, getBotServices } from './bots';
import { phoneFileAccessKey } from './botsContent';
import { sessionWorktree } from './worktree';

function context(target: PairFileTarget) {
  const authority = getSourceAuthorityRegistry();
  let conversationId: string;
  let ownerKey: string | undefined;
  let replyText: string | undefined;
  if ('sessionId' in target) conversationId = target.sessionId;
  else {
    const services = botModeEnabled() ? getBotServices() : null;
    const key = services ? phoneFileAccessKey(services, target.bot) : null;
    if (!key || !services) return null;
    ownerKey = key;
    if ('entryId' in target.bot) {
      const entry = services.chats.findEntry(target.bot.chatId, target.bot.entryId);
      if (entry?.kind !== 'bot') return null;
      conversationId = entry.conversationId;
      replyText = entry.text;
    } else conversationId = target.bot.conversationId;
  }
  const conversation = authority?.conversation(conversationId);
  if (!conversation || ('sessionId' in target && conversation.bot)) return null;
  const project = authority?.project(conversation.projectId);
  const worktree = sessionWorktree(conversationId);
  const root =
    'bot' in target
      ? conversation.lifecycle !== 'ended' &&
        project?.state === 'active' &&
        project.kind !== 'ssh' &&
        (!worktree || worktree.projectId === project.projectId)
        ? (worktree?.path ?? project.canonicalPath)
        : null
      : pickBrowserFileRoot({ conversation, project, worktree });
  if (!root) return null;
  try {
    const canonicalRoot = realpathSync(root);
    const info = statSync(canonicalRoot);
    return info.isDirectory()
      ? {
          root: canonicalRoot,
          conversation,
          replyText,
          stamp: JSON.stringify([
            target,
            conversation,
            project,
            worktree,
            ownerKey,
            replyText,
            canonicalRoot,
            info.dev,
            info.ino,
          ]),
        }
      : null;
  } catch {
    return null;
  }
}

/** Phone port only: no renderer path-bearing IPC and no public HTTP endpoint. */
export function createPairPreviewsPort(browser: PairPreviewBrowserFactory): PairPreviewPort {
  const accessKey = (target: PairFileTarget) => context(target)?.stamp ?? null;
  const lookup = async (target: PairFileTarget): Promise<PairPreviewSource | null> => {
    const before = context(target);
    if (!before) return null;
    let messages: readonly ProjectedMessage[];
    try {
      messages = await readBotSessionMessages(
        path.join(app.getPath('userData'), 'agent', 'sessions'),
        before.conversation.sessionFile
      );
    } catch {
      messages = [];
    }
    if (context(target)?.stamp !== before.stamp) return null;
    if ('bot' in target) {
      const range =
        'entryId' in target.bot
          ? turnOfReply(messages, before.replyText ?? '')
          : turnBounds(messages, target.bot.messageIndex);
      if (range) messages = messages.slice(range.start, range.end);
      else if (before.replyText)
        messages = [{ role: 'assistant', content: [{ type: 'text', text: before.replyText }] }];
      else return null;
    }
    return { root: before.root, stamp: before.stamp, messages };
  };
  return createPairPreviewPort({ lookup, accessKey, browser });
}
