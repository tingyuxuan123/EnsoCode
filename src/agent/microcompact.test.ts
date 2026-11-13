import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import * as implementation from './microcompact';

type Message = { role: string; content?: unknown; [key: string]: unknown };
type Options = { enabled?: boolean; now?: () => number };
type Contract = {
  MICROCOMPACT_TOTAL_CHARS: number;
  MICROCOMPACT_LOW_WATERMARK: number;
  MICROCOMPACT_KEEP_RECENT: number;
  MICROCOMPACT_IDLE_MS: number;
  MICROCOMPACT_PLACEHOLDER: string;
  selectMicrocompactTargets(
    messages: Message[],
    now: number,
    selected: ReadonlySet<string>
  ): string[];
  applyMicrocompact(messages: Message[], selected: ReadonlySet<string>): Message[];
  microcompactExtension(options?: Options): InlineExtension;
  collectMicrocompactStats(branch: unknown[]): { results: number; charsRemoved: number };
};

const api = implementation as unknown as Contract;
const { selectMicrocompactTargets: select, applyMicrocompact: apply } = api;
const P = api.MICROCOMPACT_PLACEHOLDER;
const NOW = 36_000_000;
const result = (id: string, chars = 1000, toolName = 'read', extra: object = {}): Message => ({
  role: 'toolResult',
  toolCallId: id,
  toolName,
  content: [{ type: 'text', text: 'x'.repeat(chars) }],
  isError: false,
  timestamp: NOW - 100,
  ...extra,
});
const assistant = (timestamp: number): Message => ({ role: 'assistant', content: [], timestamp });
const recent = () => Array.from({ length: 5 }, (_, i) => result(`keep${i}`));
const cold = () => assistant(NOW - 3_600_000);
const pick = (messages: Message[], selected: ReadonlySet<string> = new Set()) =>
  select(messages, NOW, selected);

describe('conservative microcompact selection', () => {
  it('publishes the agreed thresholds and a nonempty bounded placeholder', () => {
    expect([
      api.MICROCOMPACT_TOTAL_CHARS,
      api.MICROCOMPACT_LOW_WATERMARK,
      api.MICROCOMPACT_KEEP_RECENT,
      api.MICROCOMPACT_IDLE_MS,
    ]).toEqual([500000, 250000, 5, 3600000]);
    expect(P.length).toBeGreaterThan(0);
    expect(P.length).toBeLessThan(1000);
  });
  it('does not trigger at exactly 500000 chars or without a recent assistant timestamp', () => {
    expect(
      pick([assistant(NOW), ...Array.from({ length: 10 }, (_, i) => result(`r${i}`, 50000))])
    ).toEqual([]);
    expect(pick([result('old'), ...recent()])).toEqual([]);
  });
  it('triggers strictly above threshold and stops at low watermark including replacement chars', () => {
    const messages = [
      assistant(NOW),
      ...Array.from({ length: 11 }, (_, i) => result(`r${i}`, 50000)),
    ];
    // Five removals leave 300k; six leave 250k plus placeholders. Retention bounds further removal.
    expect(pick(messages)).toEqual(['r0', 'r1', 'r2', 'r3', 'r4', 'r5']);
    const varied = [
      assistant(NOW),
      result('a', 160000),
      result('b', 160000),
      result('c', 160000),
      ...recent(),
    ];
    varied.push(result('last', 20000));
    expect(pick(varied)).toEqual(['a', 'b']);
  });
  it('never removes the latest five eligible results even if low watermark is unreachable', () => {
    expect(
      pick([assistant(NOW), ...Array.from({ length: 10 }, (_, i) => result(`r${i}`, 100000))])
    ).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
  });
  it('idle boundary is inclusive and most recent assistant timestamp wins', () => {
    const messages = [cold(), result('old'), ...recent()];
    expect(pick(messages)).toEqual(['old']);
    expect(pick([assistant(NOW - 3_599_999), ...messages.slice(1)])).toEqual([]);
    expect(pick([...messages, assistant(NOW)])).toEqual([]);
  });
  it.each(['read', 'grep', 'find', 'ls', 'web_fetch', 'web_search'])(
    'allows successful text-only %s',
    (name) => {
      expect(pick([cold(), result('old', 1000, name), ...recent()])).toEqual(['old']);
    }
  );
  it.each([
    'bash',
    'shell',
    'task_output',
    'write',
    'edit',
    'apply_patch',
    'subagent',
    'ask_user',
    'unknown',
  ])('protects %s and does not let it consume a recent-eligible slot', (name) => {
    const protectedMessage = result('protected', 600000, name);
    expect(pick([cold(), protectedMessage, result('old'), ...recent()])).toEqual(['old']);
    expect(apply([protectedMessage], new Set(['protected']))[0]).toBe(protectedMessage);
  });
  it.each([
    { isError: true },
    { details: { externalized: true } },
    { content: [{ type: 'text', text: `receipt enso-artifact://output ${'x'.repeat(1000)}` }] },
    {
      content: [
        { type: 'text', text: 'x'.repeat(1000) },
        { type: 'image', data: 'AA==', mimeType: 'image/png' },
      ],
    },
    {
      content: [
        { type: 'text', text: 'x'.repeat(1000) },
        { type: 'unknown', text: 'secret' },
      ],
    },
    { content: 'x'.repeat(1000) },
    { content: [] },
    { content: [{ type: 'text', text: '' }] },
  ])('guards protected/unknown bodies at both selection and application: %j', (extra) => {
    const protectedMessage = result('protected', 1000, 'read', extra);
    expect(pick([cold(), protectedMessage, result('old'), ...recent()])).toEqual(['old']);
    expect(apply([protectedMessage], new Set(['protected']))[0]).toBe(protectedMessage);
  });
  it('skips selected, already cleared, and short outputs without context growth', () => {
    const messages = [
      cold(),
      result('picked'),
      result('cleared', 0, 'read', { content: [{ type: 'text', text: P }] }),
      result('short', Math.max(0, P.length - 1)),
      result('old'),
      ...recent(),
    ];
    expect(pick(messages, new Set(['picked']))).toEqual(['old']);
    expect(apply([messages[3]], new Set(['short']))[0]).toBe(messages[3]);
  });
  it('skips bodies equal to placeholder length but allows one character longer', () => {
    const equal = result('equal', P.length);
    expect(pick([cold(), equal, result('longer', P.length + 1), ...recent()])).toEqual(['longer']);
    expect(apply([equal], new Set(['equal']))[0]).toBe(equal);
  });
  it('fails closed for duplicate toolCallIds in both selection and application', () => {
    const first = result('duplicate');
    const second = result('duplicate', 2000);
    const messages = [cold(), first, second, result('unique'), ...recent()];
    expect(pick(messages)).toEqual(['unique']);
    const out = apply(messages, new Set(['duplicate', 'unique']));
    expect(out[1]).toBe(first);
    expect(out[2]).toBe(second);
    expect(out[3].content).toEqual([{ type: 'text', text: P }]);
  });
  it('concatenates all text parts when measuring eligibility and preserves metadata/references', () => {
    const details = { source: 'test' };
    const target = result('old', 0, 'read', {
      details,
      custom: 42,
      content: [
        { type: 'text', text: 'a'.repeat(600) },
        { type: 'text', text: 'b'.repeat(600) },
      ],
    });
    const messages = [cold(), target, ...recent()];
    expect(pick(messages)).toEqual(['old']);
    expect(apply(messages, new Set())).toBe(messages);
    expect(apply(messages, new Set(['absent']))).toBe(messages);
    const out = apply(messages, new Set(['old']));
    expect(out).not.toBe(messages);
    expect(out[1]).toEqual({ ...target, content: [{ type: 'text', text: P }] });
    expect(out[1].details).toBe(details);
    expect(out[0]).toBe(messages[0]);
    expect(out[2]).toBe(messages[2]);
    expect(target.content).toEqual([
      { type: 'text', text: 'a'.repeat(600) },
      { type: 'text', text: 'b'.repeat(600) },
    ]);
  });
});

type Event = Record<string, unknown>;
type Handler = (event: Event, ctx: unknown) => unknown;
function hooks(options: Options = { now: () => NOW }) {
  const handlers = new Map<string, Handler>();
  const extension = api.microcompactExtension(options);
  const factory = typeof extension === 'function' ? extension : extension.factory;
  void factory({ on: (name: string, handler: Handler) => handlers.set(name, handler) } as never);
  let contextEntries: ReturnType<typeof projected> = [];
  return async (name: string, event: Event, signal?: AbortSignal): Promise<Event> => {
    if (name === 'context') contextEntries = projected(event.messages as Message[]);
    return (
      ((await handlers.get(name)?.(event, {
        signal,
        sessionManager: { buildSessionProjection: () => ({ entries: contextEntries }) },
      })) as Event | undefined) ?? {}
    );
  };
}
const projected = (messages: Message[]) =>
  messages.map((message, i) => ({
    sourceEntry: { type: 'message', id: `e${i}`, message },
    messages: [message],
  }));
const boundary = (messages: Message[], outcome = 'completed') => ({
  type: 'turn_end',
  outcome,
  entries: [],
  continue: false,
  message: assistant(NOW),
  context: {
    contextEntries: projected(messages),
    contextMessages: messages,
    llmMessages: messages,
    pendingMessages: [],
    canContinue: true,
  },
});
const edits = (event: Event) =>
  (event.entries ?? []) as Array<{ type: string; targetId: string; replacement: unknown }>;

describe('microcompact persistence boundary', () => {
  it('cannot select a cold branch at a completed boundary without a preceding context request', async () => {
    const run = hooks();
    const messages = [cold(), result('old'), ...recent()];
    expect(edits(await run('turn_end', boundary(messages)))).toEqual([]);
  });
  it('previews without mutation, then appends content-only edits at completed turn_end', async () => {
    const run = hooks();
    const messages = [cold(), result('old'), ...recent()];
    const preview = await run('context', { messages });
    expect((preview.messages as Message[] | undefined)?.[1].content).toEqual([
      { type: 'text', text: P },
    ]);
    expect(messages[1].content).toEqual([{ type: 'text', text: 'x'.repeat(1000) }]);
    const draft = { type: 'custom', customType: 'other', data: {} };
    const end = await run('turn_end', { ...boundary(messages), entries: [draft] });
    expect(end.entries).toEqual([
      draft,
      {
        type: 'context_edit',
        targetId: 'e1',
        replacement: { content: [{ type: 'text', text: P }] },
      },
    ]);
  });
  it.each(['aborted', 'error', 'signal'])(
    'does not persist on %s, and an abandoned preview cannot poison a later fresh turn',
    async (reason) => {
      const run = hooks();
      const messages = [cold(), result('old'), ...recent()];
      await run('context', { messages });
      const controller = new AbortController();
      if (reason === 'signal') controller.abort();
      expect(
        edits(
          await run(
            'turn_end',
            boundary(messages, reason === 'signal' ? 'completed' : reason),
            controller.signal
          )
        )
      ).toEqual([]);
      const fresh = [...messages, assistant(NOW)];
      expect(edits(await run('turn_end', boundary(fresh)))).toEqual([]);
      await run('context', { messages });
      expect(edits(await run('turn_end', boundary(messages)))).toHaveLength(1);
    }
  );
  it('revalidates against actual branch rather than irrevocably selecting preview-only targets', async () => {
    const run = hooks();
    const messages = [cold(), result('old'), ...recent()];
    await run('context', { messages });
    const protectedBranch = [
      cold(),
      result('old', 1000, 'read', { details: { externalized: true } }),
      ...recent(),
    ];
    expect(edits(await run('turn_end', boundary(protectedBranch)))).toEqual([]);
    await run('context', { messages });
    expect(edits(await run('turn_end', boundary(messages)))).toHaveLength(1);
  });
  it('live disable cancels future selection, including an uncommitted preview', async () => {
    const options = { enabled: true, now: () => NOW };
    const run = hooks(options);
    const messages = [cold(), result('old'), ...recent()];
    await run('context', { messages });
    options.enabled = false;
    expect(edits(await run('turn_end', boundary(messages)))).toEqual([]);
    const preview = await run('context', { messages });
    expect(preview.messages ?? messages).toEqual(messages);
    options.enabled = true;
    expect(edits(await run('turn_end', boundary(messages)))).toEqual([]);
    await run('context', { messages });
    expect(edits(await run('turn_end', boundary(messages)))).toHaveLength(1);
  });
});

describe('persisted microcompact statistics', () => {
  const raw = (id: string, message = result(id)) => ({ type: 'message', id, message });
  const edit = (targetId: string, content: unknown = [{ type: 'text', text: P }]) => ({
    type: 'context_edit',
    targetId,
    replacement: content === null ? null : { content },
  });
  it('counts unique active targets from persisted edits and raw multipart body lengths only', () => {
    const branch = [
      raw('a'),
      raw(
        'b',
        result('b', 0, 'grep', {
          content: [
            { type: 'text', text: 'a'.repeat(700) },
            { type: 'text', text: 'b'.repeat(800) },
          ],
        })
      ),
      edit('a'),
      edit('a'),
      edit('b'),
    ];
    expect(api.collectMicrocompactStats(branch)).toEqual({
      results: 2,
      charsRemoved: 2500 - 2 * P.length,
    });
  });
  it('ignores previews, dangling targets, deletions, unrelated replacements, and superseded edits', () => {
    expect(api.collectMicrocompactStats([raw('a')])).toEqual({ results: 0, charsRemoved: 0 });
    const branch = [
      raw('a'),
      raw('b'),
      raw('c'),
      raw('d'),
      edit('a'),
      edit('a', [{ type: 'text', text: 'restored' }]),
      edit('b', null),
      edit('c', [{ type: 'text', text: 'unrelated' }]),
      edit('missing'),
      edit('d'),
    ];
    expect(api.collectMicrocompactStats(branch)).toEqual({
      results: 1,
      charsRemoved: 1000 - P.length,
    });
  });
});
