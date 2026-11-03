import { splitPowerShellCommand } from '../rtk/powershell';

export const DEFAULT_FOREGROUND_YIELD_MS = 45_000;
export const MAX_SHELL_TIMEOUT_SEC = 2_147_483_647 / 1000;

/** timeout is a kill deadline, never a foreground waiting budget. */
export function shellTimeoutSec(value: unknown): number | undefined {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_SHELL_TIMEOUT_SEC
    ? value
    : undefined;
}

/** Not a shell parser: uncertain syntax makes the whole scan fall back to default. */
function statements(source: string): string[][] | undefined {
  const result: string[][] = [];
  let words: string[] = [];
  let word = '';
  let opaque = false;
  const flush = () => {
    if (word || opaque) words.push(opaque ? '\0' : word);
    word = '';
    opaque = false;
  };
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if ('\'"'.includes(char)) {
      opaque = true;
      const quote = char;
      let closed = false;
      while (++i < source.length) {
        if (source[i] === '\\' && quote === '"') i++;
        else if (source[i] === quote) {
          closed = true;
          break;
        }
      }
      if (!closed) return undefined;
    } else if (char === '#' && !word && !opaque) {
      while (i < source.length && source[i] !== '\n') i++;
      flush();
      result.push(words);
      words = [];
    } else if ('(){}[]<>$`\\'.includes(char)) {
      return undefined;
    } else if (';&|\n\r'.includes(char)) {
      flush();
      result.push(words);
      words = [];
    } else if (/\s/.test(char)) flush();
    else word += char;
  }
  flush();
  result.push(words);
  return result;
}

function commandClass(input: string[]): 'server' | 'build' | 'default' {
  const words = [...input];
  while (/^[A-Za-z_]\w*=/.test(words[0] ?? '')) words.shift();
  if (['env', 'command', 'exec', 'time'].includes(words[0])) words.shift();
  if (['npx', 'bunx'].includes(words[0])) words.shift();
  if (['pnpm', 'yarn', 'bun'].includes(words[0]) && ['exec', 'dlx', 'x'].includes(words[1]))
    words.splice(0, 2);
  const program = words
    .shift()
    ?.replace(/\.exe$/i, '')
    .toLowerCase();
  if (!program || words.some((w) => ['--help', '-h', '--version', '-V'].includes(w)))
    return 'default';
  const packageManager = ['npm', 'pnpm', 'yarn', 'bun'].includes(program);
  if (packageManager) {
    while (words[0]?.startsWith('-')) {
      const flag = words.shift();
      if (['--filter', '-F', '-C', '--dir', '--prefix', '--workspace', '-w'].includes(flag ?? ''))
        words.shift();
      else if (
        !['-r', '--recursive', '--silent', '-s'].includes(flag ?? '') &&
        !flag?.includes('=')
      )
        return 'default';
    }
    if (words[0] === 'run') words.shift();
    if (['dev', 'start', 'serve', 'watch', 'preview'].includes(words[0])) return 'server';
    if (
      [
        'build',
        'test',
        'lint',
        'typecheck',
        'check',
        'ci',
        'install',
        'i',
        'add',
        'e2e',
        'coverage',
        'compile',
      ].includes(words[0])
    )
      return 'build';
    return 'default';
  }
  const watchPrograms = ['tsc', 'vitest', 'jest', 'webpack', 'rollup', 'esbuild', 'node', 'deno'];
  if (
    watchPrograms.includes(program) &&
    words.some((w) => /^(?:--watch(?:All)?(?:=true)?|-w)$/.test(w))
  )
    return 'server';
  if (
    ['nodemon', 'http-server', 'live-server', 'serve', 'uvicorn', 'gunicorn', 'watchexec'].includes(
      program
    )
  )
    return 'server';
  if (program === 'vite')
    return words.length === 0 || ['dev', 'serve', 'preview'].includes(words[0])
      ? 'server'
      : words[0] === 'build'
        ? 'build'
        : 'default';
  if (['next', 'nuxt', 'astro'].includes(program) && ['dev', 'start', 'preview'].includes(words[0]))
    return 'server';
  if (
    /^python[\d.]*$/.test(program) &&
    words[0] === '-m' &&
    ['http.server', 'uvicorn'].includes(words[1])
  )
    return 'server';
  if (
    [
      'tsc',
      'vitest',
      'jest',
      'pytest',
      'make',
      'cmake',
      'ninja',
      'mvn',
      'gradle',
      'eslint',
      'biome',
      'webpack',
      'rollup',
      'esbuild',
      'xcodebuild',
    ].includes(program)
  )
    return 'build';
  if (
    ['cargo', 'go', 'dotnet', 'swift', 'deno'].includes(program) &&
    ['build', 'test', 'check', 'install', 'restore', 'publish', 'compile'].includes(words[0])
  )
    return 'build';
  if (['pip', 'pip3'].includes(program) && words[0] === 'install') return 'build';
  return 'default';
}

/** Classifies the original command, before RTK/SSH rewriting; never authorizes execution. */
export function foregroundYieldMs(command: unknown, shell = 'bash'): number {
  if (typeof command !== 'string') return DEFAULT_FOREGROUND_YIELD_MS;
  let source = command;
  if (shell === 'powershell') {
    const parts = splitPowerShellCommand(command);
    if (!parts) return DEFAULT_FOREGROUND_YIELD_MS;
    source = parts
      .filter((p) => p.kind === 'statement')
      .map((p) => p.text.replace(/^\s*&\s*/, ''))
      .join(';');
  }
  const scanned = statements(source);
  if (!scanned) return DEFAULT_FOREGROUND_YIELD_MS;
  const classes = scanned.map(commandClass);
  return classes.includes('server')
    ? 10_000
    : classes.includes('build')
      ? 180_000
      : DEFAULT_FOREGROUND_YIELD_MS;
}
