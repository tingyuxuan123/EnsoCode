import { expect, it } from 'vitest';
import { toVettaFileUrl } from '../src/cards/file-url';
it('does not generate privileged vetta-file URLs in EnsoCode', () => {
  expect(() => toVettaFileUrl('/work/a.vetd/.snapshots/1.png')).toThrow('P1');
});
