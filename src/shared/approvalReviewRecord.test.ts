import { describe, expect, it } from 'vitest';
import {
  parseApprovalAllowThreshold,
  parseApprovalReviewRecord,
  readApprovalProbabilities,
} from './approvalReviewRecord';

describe('managed approval boundaries', () => {
  it('accepts only the three numeric thresholds', () => {
    for (const value of [undefined, null, '0.85', 0, 1, 0.89, NaN, Infinity]) {
      expect(parseApprovalAllowThreshold(value)).toBe(0.9);
    }
    for (const value of [0.85, 0.9, 0.95]) expect(parseApprovalAllowThreshold(value)).toBe(value);
  });
  it('requires a complete finite normalized distribution, never fills missing fields', () => {
    for (const probabilities of [
      { allow: 1 },
      { allow: 0.95, ask: 0.05 },
      { allow: NaN, ask: 0, block: 0 },
      { allow: Infinity, ask: 0, block: 0 },
      { allow: 0.95, ask: 0, block: 0.95 },
      { allow: 0.95, ask: 0.3, block: 0 },
      { allow: 0.9, ask: 0, block: 0 },
      { allow: -0.1, ask: 1, block: 0.1 },
      { allow: 1, ask: 0, block: 0, extra: 1 },
    ])
      expect(readApprovalProbabilities(probabilities)).toBeNull();
    expect(readApprovalProbabilities({ allow: 0.9, ask: 0.08, block: 0.02 })).toEqual({
      allow: 0.9,
      ask: 0.08,
      block: 0.02,
    });
  });
  it('projects only a safe audit whitelist, including fallback', () => {
    const record = {
      verdict: 'allow',
      model: 'system-one',
      actionHash: 'a'.repeat(64),
      allow: 0.95,
      ask: 0.04,
      block: 0.01,
    };
    expect(
      parseApprovalReviewRecord({ ...record, apiKey: 'secret', request: { secret: 'x' } })
    ).toEqual(record);
    expect(parseApprovalReviewRecord({ ...record, allow: 0.99 })).toBeUndefined();
    expect(
      parseApprovalReviewRecord({
        verdict: 'fallback',
        model: 'system-one',
        actionHash: 'a'.repeat(64),
        fallback: 'timeout',
        apiKey: 'secret',
      })
    ).toEqual({
      verdict: 'fallback',
      model: 'system-one',
      actionHash: 'a'.repeat(64),
      fallback: 'timeout',
    });
    expect(
      parseApprovalReviewRecord({ ...record, model: 'https://user:secret@host/model' })
    ).toBeUndefined();
  });
});
