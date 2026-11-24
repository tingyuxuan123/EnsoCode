import path from 'node:path';
import type { PairFileTarget } from '@enso/pair';
import { app } from 'electron';
import { pickBrowserFileRoot } from '../services/browserFileRoot';
import {
  createPairFilePort,
  PAIR_FILE_LIST_LIMIT,
  type PairFilePort,
  type PairFileSource,
} from '../services/pairFiles';
import { readPairSessionMessages } from '../services/pairSessionHistory';
import { artifactCandidates, resolveArtifacts } from '../services/workspaceArtifacts';
import { getSourceAuthorityRegistry } from './agent';
import { sessionWorktree } from './worktree';

/** 会话的权威文件根（项目/工作树/浏览器目录）：手机文件与图片端口共用，不接受手机传路径 */
export function codeFileContext(sessionId: string) {
  const authority = getSourceAuthorityRegistry();
  const conversation = authority?.conversation(sessionId);
  if (!conversation) return null;
  const project = authority?.project(conversation.projectId);
  const worktree = sessionWorktree(sessionId);
  const root = pickBrowserFileRoot({ conversation, project, worktree });
  return root
    ? { root, conversation, stamp: JSON.stringify([conversation, project, worktree]) }
    : null;
}

/** This is a phone service port, not a new renderer IPC or a path-bearing API. */
export function createPairFilesPort(): PairFilePort {
  const accessKey = (target: PairFileTarget): string | null =>
    codeFileContext(target.sessionId)?.stamp ?? null;
  const canAccess = (target: PairFileTarget): boolean => accessKey(target) !== null;
  const lookup = async (target: PairFileTarget): Promise<PairFileSource | null> => {
    const before = codeFileContext(target.sessionId);
    if (!before) return null;
    const messages = await readPairSessionMessages(
      path.join(app.getPath('userData'), 'agent', 'sessions'),
      before.conversation.sessionFile
    );
    if (codeFileContext(target.sessionId)?.stamp !== before.stamp) return null;
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
