import type { ShellFailure } from './types/agent';

export const SHELL_FAILURE_DISPLAY: Record<ShellFailure['kind'], { label: string; next: string }> =
  {
    deadline: {
      label: 'Timeout deadline',
      next: 'Inspect the output and duration before choosing a new timeout. Do not rerun automatically.',
    },
    yield_failed: {
      label: 'Background unavailable',
      next: 'The command was stopped because the background quota is full. Stop an unneeded task before running it again.',
    },
    exit_nonzero: {
      label: 'Command failed',
      next: 'Read the error output and fix the cause before running again.',
    },
    tty_required: {
      label: 'Terminal required',
      next: 'Use a non-interactive command, or ask the user to run it in a terminal.',
    },
    auth_required: {
      label: 'Authentication required',
      next: 'Ask the user to authenticate through their existing credentials setup.',
    },
    not_found: {
      label: 'Program not found',
      next: 'Check the command name, PATH, and project-local executable.',
    },
    not_executable: {
      label: 'Not executable',
      next: 'Check permissions or invoke the file with its interpreter.',
    },
  };
