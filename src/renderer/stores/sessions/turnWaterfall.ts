import type { ProjectedMessage } from '@shared/types/agent';

export interface WaterfallSpan {
  kind: 'model' | 'tool' | 'input' | 'gap';
  start: number;
  end: number;
  name?: string;
  first?: number;
  thought?: number;
}

export interface TurnWaterfall {
  elapsedMs: number;
  spans: WaterfallSpan[];
  slowest?: number;
}

/** Only completed worker measurements. A wall-clock gap has no known cause. */
export function buildTurnWaterfall(
  messages: readonly ProjectedMessage[],
  from: number,
  through: number
): TurnWaterfall | undefined {
  const measured: WaterfallSpan[] = [];
  for (let i = from; i <= through; i++) {
    const message = messages[i];
    if (message?.role === 'assistant' && message.timing) {
      const { stepStartMs: start, completedMs: end, firstTokenMs, thinkingEndMs } = message.timing;
      if (!Number.isFinite(start) || end === undefined || !Number.isFinite(end) || end <= start)
        continue;
      const span: WaterfallSpan = { kind: 'model', start, end };
      if (firstTokenMs !== undefined && firstTokenMs > start && firstTokenMs < end) {
        span.first = firstTokenMs;
        if (thinkingEndMs !== undefined && thinkingEndMs > firstTokenMs && thinkingEndMs < end)
          span.thought = thinkingEndMs;
      }
      measured.push(span);
    } else if (message?.role === 'toolResult') {
      const { toolCompletedAt: end, toolDurationMs: duration, toolName: name } = message;
      if (end === undefined || duration === undefined || !Number.isFinite(end) || duration <= 0)
        continue;
      const start = end - duration;
      if (!Number.isFinite(start) || start < 0 || end <= start) continue;
      measured.push(
        name === 'ask_user' ? { kind: 'input', start, end } : { kind: 'tool', name, start, end }
      );
    }
  }
  if (!measured.length || (measured.length === 1 && measured[0].first === undefined)) return;
  measured.sort((a, b) => a.start - b.start);
  const origin = measured[0].start;
  let reached = origin;
  let slowest: number | undefined;
  let longest = 0;
  let active = 0;
  const spans: WaterfallSpan[] = [];
  for (const span of measured) {
    if (span.start - reached >= 1_000)
      spans.push({ kind: 'gap', start: reached - origin, end: span.start - origin });
    if (span.kind === 'model' || span.kind === 'tool') {
      active++;
      if (span.end - span.start > longest) {
        longest = span.end - span.start;
        slowest = spans.length;
      }
    }
    reached = Math.max(reached, span.end);
    spans.push({
      ...span,
      start: span.start - origin,
      end: span.end - origin,
      ...(span.first !== undefined ? { first: span.first - origin } : {}),
      ...(span.thought !== undefined ? { thought: span.thought - origin } : {}),
    });
  }
  return { elapsedMs: reached - origin, spans, ...(active > 1 ? { slowest } : {}) };
}

export function sameTurnWaterfall(a?: TurnWaterfall, b?: TurnWaterfall): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.elapsedMs === b.elapsedMs &&
      a.slowest === b.slowest &&
      a.spans.length === b.spans.length &&
      a.spans.every((span, i) => {
        const other = b.spans[i];
        return (
          span.kind === other.kind &&
          span.start === other.start &&
          span.end === other.end &&
          span.name === other.name &&
          span.first === other.first &&
          span.thought === other.thought
        );
      }))
  );
}
