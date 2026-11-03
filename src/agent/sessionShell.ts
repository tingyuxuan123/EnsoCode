import {
  type BashOperations,
  type BashToolOptions,
  createBashToolDefinition,
  createLocalBashOperations,
  createLocalPowerShellOperations,
  createPowerShellToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { childProfileShell } from '@shared/childProfileTools';
import type { WindowsLocalShell } from '@shared/windowsLocalShell';
import { withDetachableExec } from './foregroundCommand';
import { hardenedEnv } from './shell/hardenedEnv';

export type SessionShellKind = 'bash' | 'powershell';

export function resolveSessionShellKind(input: {
  platform: string;
  remote?: boolean;
  preference?: WindowsLocalShell;
}): SessionShellKind {
  return childProfileShell(input);
}

export function createSessionCommandTool(input: {
  cwd: string;
  platform?: NodeJS.Platform;
  remote?: boolean;
  preference?: WindowsLocalShell;
  operations?: BashOperations;
}): ReturnType<typeof createBashToolDefinition> {
  const kind = resolveSessionShellKind({
    platform: input.platform ?? process.platform,
    remote: input.remote,
    preference: input.preference,
  });
  const local = kind === 'powershell' ? createLocalPowerShellOperations : createLocalBashOperations;
  const options: BashToolOptions = { operations: withDetachableExec(input.operations ?? local()) };
  // 保留 pi 已构造的 PATH / PI_*；外部（SSH）operations 自己负责环境。
  if (!input.operations) {
    options.spawnHook = (context) => ({
      ...context,
      env: hardenedEnv(context.env, { shell: kind }),
    });
  }
  return kind === 'powershell'
    ? createPowerShellToolDefinition(input.cwd, options)
    : createBashToolDefinition(input.cwd, options);
}
