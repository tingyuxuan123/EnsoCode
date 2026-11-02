import { SearchLlmGate } from '@shared/memory/searchAssist';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Complete } from './distill';
import { createSearchAssist } from './searchLlm';

afterEach(() => vi.useRealTimers());

describe('deep search completion 生命周期', () => {
  it.each([1500, 8000])('后端预算 %i ms 到期真正 abort，迟到结果不改变 outcome', async (budget) => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    let resolve!: (text: string) => void;
    const complete: Complete = (_s, _u, opts) => {
      signal = opts?.signal;
      return new Promise((done) => {
        resolve = done;
      });
    };
    complete.searchTimeoutMs = budget;
    const assist = createSearchAssist(complete, { gate: new SearchLlmGate() })!;
    const pending = assist.analyze('Postgres');
    await vi.advanceTimersByTimeAsync(budget);
    await expect(pending).resolves.toBeNull();
    expect(signal?.aborted).toBe(true);
    expect(assist.outcome?.()).toEqual({ assist: 'fallback', assistReason: 'timeout' });
    resolve('{"intent":"factual_query","confidence":1}');
    await Promise.resolve();
    expect(assist.outcome?.()).toEqual({ assist: 'fallback', assistReason: 'timeout' });
  });

  it('调用者取消传播到 completion，不把取消记作模型故障退避', async () => {
    let signal: AbortSignal | undefined;
    const complete: Complete = (_s, _u, opts) => {
      signal = opts?.signal;
      return new Promise(() => {});
    };
    const gate = new SearchLlmGate();
    const assist = createSearchAssist(complete, { gate })!;
    const caller = new AbortController();
    const pending = assist.analyze('Postgres', caller.signal);
    caller.abort();
    await expect(pending).resolves.toBeNull();
    expect(signal?.aborted).toBe(true);
    expect(gate.available()).toBe(true);
    expect(assist.outcome?.()).toEqual({ assist: 'fallback', assistReason: 'cancelled' });
  });

  it('坏 JSON 回退；成功 rerank 后注明真正用上 LLM', async () => {
    let step = 0;
    const assist = createSearchAssist(async () => (++step === 1 ? 'bad json' : '{"scores":[7]}'), {
      gate: new SearchLlmGate(),
    })!;
    expect(await assist.analyze('Postgres')).toBeNull();
    expect(assist.outcome?.()).toEqual({ assist: 'fallback', assistReason: 'unparseable' });
    expect(await assist.rerank('Postgres', [{ title: 'Postgres', content: 'db' }])).toEqual([7]);
    expect(assist.outcome?.()).toEqual({ assist: 'llm' });
  });
});
