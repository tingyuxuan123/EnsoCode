import type { PluginAuthoringCheck } from '@shared/extensionPlugins/types';

/** A green static row must never imply a completed delivery. */
export function authoringCheckLabel(check: PluginAuthoringCheck): string {
  if (check.state === 'stale') return 'Source changed — recheck';
  if (check.state === 'unverified') return 'Not verified';
  if (check.state === 'failed') return 'Failed';
  return check.reportedBy === 'user' ? 'User-reported verification' : 'Passed';
}
