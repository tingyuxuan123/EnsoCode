export class ComputerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ComputerError';
    this.code = code;
  }
}

export class StaleRefError extends ComputerError {
  constructor(reference: string, detail = 'expired') {
    super('stale-ref', `${reference} ${detail}; re-run ax()/find()`);
    this.name = 'StaleRef';
  }
}

export class BackgroundUnavailableError extends ComputerError {
  constructor(detail: string) {
    super(
      'background-unavailable',
      `${detail}; retry with delivery:"foreground" or use AX actions`
    );
    this.name = 'BackgroundUnavailable';
  }
}

export class PermissionError extends ComputerError {
  constructor(
    readonly permission: 'capture' | 'input' | 'ax',
    message: string
  ) {
    super('permission', message);
    this.name = 'PermissionError';
  }
}

export class ReadOnlyError extends ComputerError {
  constructor(method: string) {
    super('read-only', `read-only run: '${method}' requires read_only: false`);
    this.name = 'ReadOnlyError';
  }
}

export class FrameError extends ComputerError {
  constructor(message: string) {
    super('frame', message);
    this.name = 'FrameError';
  }
}
