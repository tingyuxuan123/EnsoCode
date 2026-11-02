import path from 'node:path';
import type { PairFileTarget } from '@enso/pair';
import { app } from 'electron';
import { artifactCandidates, resolveArtifacts } from '../services/bots/artifacts';
import { readBotSessionMessages } from '../services/bots/sessionMessages';
import { pickBrowserFileRoot } from '../services/browserFileRoot';
import {
  createPairFilePort,
  PAIR_FILE_LIST_LIMIT,
  type PairFilePort,
  type PairFileSource,
} from '../services/pairFiles';
import { getSourceAuthorityRegistry } from './agent';
import { botModeEnabled, getBotServices } from './bots';
import { phoneFileAccessKey, phoneFileSource } from './botsContent';
import { sessionWorktree } from './worktree';

function codeContext(sessionId: string) {
  const authority = getSourceAuthorityRegistry();
  const conversation = authority?.conversation(sessionId);
  if (!conversation || conversation.bot) return null;
  const project = authority?.project(conversation.projectId);
  const worktree = sessionWorktree(sessionId);
  const root = pickBrowserFileRoot({ conversation, project, worktree });
  return root
    ? { root, conversation, stamp: JSON.stringify([conversation, project, worktree]) }
    : null;
}

/** This is a phone service port, not a new renderer IPC or a path-bearing API. */
export function createPairFilesPort(): PairFilePort {
  const accessKey = (target: PairFileTarget): string | null => {
    if ('sessionId' in target) return codeContext(target.sessionId)?.stamp ?? null;
    const services = botModeEnabled() ? getBotServices() : null;
    return services ? phoneFileAccessKey(services, target.bot) : null;
  };
  const canAccess = (target: PairFileTarget): boolean => accessKey(target) !== null;
  const lookup = async (target: PairFileTarget): Promise<PairFileSource | null> => {
    if ('bot' in target) {
      const services = botModeEnabled() ? getBotServices() : null;
      if (!services) return null;
      const source = await phoneFileSource(services, target.bot);
      return botModeEnabled() && getBotServices() === services && canAccess(target) ? source : null;
    }
    const before = codeContext(target.sessionId);
    if (!before) return null;
    const messages = await readBotSessionMessages(
      path.join(app.getPath('userData'), 'agent', 'sessions'),
      before.conversation.sessionFile
    );
    if (codeContext(target.sessionId)?.stamp !== before.stamp) return null;
    return {
      root: before.root,
      artifacts: resolveArtifacts(
        before.root,
        [...new Set([...messages].reverse().flatMap((message) => artifactCandidates([message])))],
        PAIR_FILE_LIST_LIMIT
      ),
    };
  };
  return { ...createPairFilePort(lookup), canAccess, accessKey };
}
