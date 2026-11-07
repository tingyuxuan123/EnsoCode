import { win32 } from 'node:path';
import {
  type BashOperations,
  type BashToolOptions,
  createBashToolDefinition,
  createLocalBashOperations,
  createLocalPowerShellOperations,
  createPowerShellToolDefinition,
  getPowerShellConfig,
} from '@earendil-works/pi-coding-agent';
import { childProfileShell } from '@shared/childProfileTools';
import type { WindowsLocalShell } from '@shared/windowsLocalShell';
import { withDetachableExec } from './foregroundCommand';
import { hardenedEnv } from './shell/hardenedEnv';

export type SessionShellKind = 'bash' | 'powershell';

const PWSH_NOTE = 'Runs in PowerShell 7+ (pwsh).';
const WINDOWS_POWERSHELL_NOTE =
  'Runs in Windows PowerShell 5.1 (powershell.exe), not PowerShell 7: `&&`, `||`, `?:` and `??` are unsupported, ' +
  'so chain with `cmd1; if ($?) { cmd2 }`. `>` and Out-File write UTF-16LE; pass `-Encoding utf8` when writing text files.';

/** 按实际解析到的可执行文件告诉模型 PowerShell 版本；5.1 与 7 的语法和默认编码不同。 */
function powerShellNote(resolve: () => { shell: string }): string | undefined {
  let shell: string;
  try {
    shell = resolve().shell;
  } catch {
    // 找不到 PowerShell 时由执行阶段报错，建工具不应失败。
    return undefined;
  }
  return /^pwsh(\.exe)?$/i.test(win32.basename(shell)) ? PWSH_NOTE : WINDOWS_POWERSHELL_NOTE;
}

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
  /** 测试注入；缺省与执行阶段相同的 pi 解析顺序（pwsh 优先，回落 Windows PowerShell）。 */
  resolvePowerShell?: () => { shell: string; args: string[] };
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
  if (kind === 'bash') return createBashToolDefinition(input.cwd, options);
  const definition = createPowerShellToolDefinition(input.cwd, options);
  const note = powerShellNote(input.resolvePowerShell ?? getPowerShellConfig);
  return note ? { ...definition, description: `${definition.description} ${note}` } : definition;
}
