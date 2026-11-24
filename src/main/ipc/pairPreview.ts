import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import type { PairFileTarget } from '@enso/pair';
import type { ProjectedMessage } from '@shared/types/agent';
import { app } from 'electron';
import type {
  PairPreviewBrowserFactory,
  PairPreviewPort,
  PairPreviewSource,
} from '../services/pairPreview';
import { createPairPreviewPort } from '../services/pairPreview';
import { readPairSessionMessages } from '../services/pairSessionHistory';

import { codeFileContext } from './pairFiles';

function context(target: PairFileTarget) {
  const source = codeFileContext(target.sessionId);
  if (!source) return null;
  const { root, conversation } = source;
  try {
    const canonicalRoot = realpathSync(root);
    const info = statSync(canonicalRoot);
    return info.isDirectory()
      ? {
          root: canonicalRoot,
          conversation,
          stamp: JSON.stringify([source.stamp, canonicalRoot, info.dev, info.ino]),
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
      messages = await readPairSessionMessages(
        path.join(app.getPath('userData'), 'agent', 'sessions'),
        before.conversation.sessionFile
      );
    } catch {
      messages = [];
    }
    if (context(target)?.stamp !== before.stamp) return null;
    return { root: before.root, stamp: before.stamp, messages };
  };
  return createPairPreviewPort({ lookup, accessKey, browser });
}
