import { describe, expect, it } from 'vitest';
import { classifyShellFailure } from './failure';

describe('展示性失败分类', () => {
  it.each([
    ['sudo: a terminal is required', 1, 'tty_required'],
    ['the input device is not a TTY', 1, 'tty_required'],
    ['fatal: could not read Username: terminal prompts disabled', 128, 'auth_required'],
    ['Permission denied (publickey).', 255, 'auth_required'],
    ['missing: command not found', 127, 'not_found'],
    ['file permission denied', 126, 'not_executable'],
    ['test assertion failed', 1, 'exit_nonzero'],
    ['example: timeout:10', 1, 'exit_nonzero'],
  ] as const)('%s', (output, code, kind) => {
    expect(classifyShellFailure(output, code)).toEqual({ kind, exitCode: code });
  });
  it('受控 cause 优先于输出内容；没有 retryable/授权字段', () => {
    expect(classifyShellFailure('command not found', undefined, 'deadline')).toEqual({
      kind: 'deadline',
    });
    expect(classifyShellFailure('authentication failed', undefined, 'yield_failed')).toEqual({
      kind: 'yield_failed',
    });
  });
});
