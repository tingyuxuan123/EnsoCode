import type { ShellFailure } from '@shared/types/agent';

/** Call only for a known failure; successful output, including example errors, is never classified. */
export function classifyShellFailure(
  tail: string,
  exitCode?: number,
  cause?: 'deadline' | 'yield_failed'
): ShellFailure {
  if (cause) return { kind: cause, ...(exitCode === undefined ? {} : { exitCode }) };
  const text = tail.slice(-4000).toLowerCase();
  let kind: ShellFailure['kind'] = 'exit_nonzero';
  if (
    /not a (?:tty|terminal)|no tty present|inappropriate ioctl|requires? (?:an? )?(?:interactive )?terminal|a terminal is required|must be run from a terminal|cannot open terminal|input is not from a terminal/.test(
      text
    )
  )
    kind = 'tty_required';
  else if (
    /permission denied \(publickey\)|could not read (?:username|password)|host key verification failed|authentication failed|terminal prompts disabled|invalid username or password/.test(
      text
    )
  )
    kind = 'auth_required';
  else if (
    exitCode === 127 ||
    /command not found|is not recognized as (?:an internal or external command|the name of a cmdlet)/.test(
      text
    )
  )
    kind = 'not_found';
  else if (exitCode === 126) kind = 'not_executable';
  return { kind, ...(exitCode === undefined ? {} : { exitCode }) };
}

export function shellDetails(
  details: unknown,
  fields: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...(details && typeof details === 'object' && !Array.isArray(details) ? details : {}),
    ...fields,
  };
}
