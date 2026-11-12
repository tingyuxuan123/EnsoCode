import type { ProjectedMessage } from '@shared/types/agent';
import { describe, expect, it } from 'vitest';
import { buildTurnWaterfall } from './turnWaterfall';

const model = (
  stepStartMs: number,
  completedMs: number,
  firstTokenMs?: number,
  thinkingEndMs?: number
): ProjectedMessage => ({
  role: 'assistant',
  content: [],
  timing: { stepStartMs, completedMs, firstTokenMs, thinkingEndMs },
});

const tool = (
  toolName: string,
  toolCompletedAt: number,
  toolDurationMs: number
): ProjectedMessage => ({
  role: 'toolResult',
  content: [],
  toolName,
  timestamp: toolCompletedAt + 20_000, // Pi can publish a parallel batch long after this tool ends.
  toolCompletedAt,
  toolDurationMs,
});

describe('buildTurnWaterfall', () => {
  it('separates model phases, measured tool work, human input, and unattributed gaps', () => {
    const waterfall = buildTurnWaterfall(
      [
        model(100, 600), // preceding turn
        model(1_000, 3_000, 1_400, 2_000),
        tool('bash', 6_000, 3_000),
        tool('read', 5_000, 1_000), // parallel; not an extra elapsed second
        tool('ask_user', 16_000, 10_000),
        model(18_000, 19_000, 18_200),
      ],
      1,
      5
    );

    expect(waterfall).toEqual({
      elapsedMs: 18_000,
      slowest: 1,
      spans: [
        { kind: 'model', start: 0, end: 2_000, first: 400, thought: 1_000 },
        { kind: 'tool', name: 'bash', start: 2_000, end: 5_000 },
        { kind: 'tool', name: 'read', start: 3_000, end: 4_000 },
        { kind: 'input', start: 5_000, end: 15_000 },
        { kind: 'gap', start: 15_000, end: 17_000 },
        { kind: 'model', start: 17_000, end: 18_000, first: 17_200 },
      ],
    });
  });

  it('does not invent breakdowns for historical or invalid timing', () => {
    expect(
      buildTurnWaterfall(
        [
          { role: 'assistant', content: [], timestamp: 12, duration: 10 },
          { role: 'toolResult', content: [], timestamp: 60, toolDurationMs: 20 },
          model(20, 20),
          tool('read', Number.NaN, 42),
          model(100, 200, 500, 150),
        ],
        0,
        4
      )
    ).toBeUndefined();
  });

  it('can explain a single request when first output is measured', () => {
    expect(buildTurnWaterfall([model(500, 1_500, 800)], 0, 0)).toEqual({
      elapsedMs: 1_000,
      spans: [{ kind: 'model', start: 0, end: 1_000, first: 300 }],
    });
  });
});
