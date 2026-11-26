import { expect, it } from 'vitest';
import { authoringCheckLabel } from './authoringStatus';

it('keeps manual attestation, stale checks, failures and unverified work distinct', () => {
  expect(authoringCheckLabel({ state: 'passed', detail: 'static' })).toBe('Passed');
  expect(authoringCheckLabel({ state: 'passed', detail: 'business', reportedBy: 'user' })).toBe(
    'User-reported verification'
  );
  expect(authoringCheckLabel({ state: 'stale', detail: '' })).toBe('Source changed — recheck');
  expect(authoringCheckLabel({ state: 'unverified', detail: '' })).toBe('Not verified');
});
