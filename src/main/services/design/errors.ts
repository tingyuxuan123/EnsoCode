import type { DesignErrorCode, DesignFailure } from '@shared/types/design';

export class DesignServiceError extends Error {
  constructor(
    readonly code: DesignErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'DesignServiceError';
  }
}
export function failure(error: unknown): DesignFailure {
  const code =
    error instanceof DesignServiceError
      ? error.code
      : isErrno(error, 'ENOENT')
        ? 'NOT_FOUND'
        : 'FAILED';
  return {
    ok: false,
    code,
    error: (error instanceof Error ? error.message : String(error)).slice(0, 8000),
  };
}
export function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
export function tooLarge(): never {
  throw new DesignServiceError('TOO_LARGE', 'Design data exceeds size limit');
}
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_LIST_FILES = 10000;
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
