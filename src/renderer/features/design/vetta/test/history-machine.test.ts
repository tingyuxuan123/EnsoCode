import { expect, it } from 'vitest';
import { machineLocalPath, machineOf } from '../src/history/machine';
import { designPaths } from '../../host/paths';
it('retains upstream machine display helpers', () => {
  expect(machineOf('ssh://host/home/a')).toBe('ssh://host');
  expect(machineLocalPath('ssh://host/home/a')).toBe('/home/a');
});
it('does not route remote filesystem paths through local design IPC', () => {
  expect(() => designPaths.map('ssh://host/home/a.vetd')).toThrow();
});
