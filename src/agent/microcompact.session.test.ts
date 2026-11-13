import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AssistantMessage, TranscriptContext } from '@earendil-works/pi-ai';
import { getModel } from '@earendil-works/pi-ai/compat';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { afterEach, expect, it, vi } from 'vitest';
import {
  collectMicrocompactStats,
  MICROCOMPACT_IDLE_MS,
  microcompactExtension,
  MICROCOMPACT_PLACEHOLDER as P,
} from './microcompact';
import { buildSessionDisplayMessages } from './sessionAdapter';

const model = getModel('openai', 'gpt-4o-mini');
if (!model) throw new Error('Bundled test model unavailable');
const body = (name: string) => `RAW-${name}-${'x'.repeat(1000)}`;
const read: ToolDefinition = {
  name: 'read',
  label: 'Read',
  description: 'Read fixture text.',
  parameters: Type.Object({ path: Type.String() }),
  execute: async (_id, params) => ({
    content: [{ type: 'text', text: body((params as { path: string }).path) }],
    details: undefined,
  }),
};
function reply(content: AssistantMessage['content']): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: model!.api,
    provider: model!.provider,
    model: model!.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: content.some((part) => part.type === 'toolCall') ? 'toolUse' : 'stop',
    timestamp: Date.now(),
  };
}
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

async function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'enso-microcompact-contract-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'workspace');
  const agentDir = path.join(root, 'agent');
  mkdirSync(cwd, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  const runtime = await ModelRuntime.create({
    authPath: path.join(agentDir, 'auth.json'),
    modelsPath: path.join(agentDir, 'models.json'),
    refreshOnCreate: false,
  });
  vi.spyOn(runtime, 'hasConfiguredAuth').mockReturnValue(true);
  const plans: AssistantMessage[] = [];
  const requests: TranscriptContext[] = [];
  let skew = 0;
  vi.spyOn(runtime, 'streamSimple').mockImplementation((_model, context) => {
    requests.push(structuredClone(context as TranscriptContext));
    const message = plans.shift();
    if (!message) throw new Error('Unexpected extra provider request');
    // Model timestamps share the injected clock, so each completed response resets idle age.
    message.timestamp = Date.now() + skew;
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'done', reason: message.stopReason as 'stop', message });
    return stream;
  });
  const options = { enabled: true, now: () => Date.now() + skew };
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: 'Bounded microcompact fixture.',
    extensionFactories: [microcompactExtension(options)],
  });
  await resourceLoader.reload();
  const manager = SessionManager.create(cwd, path.join(root, 'sessions'));
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime: runtime,
    model,
    thinkingLevel: 'off',
    resourceLoader,
    sessionManager: manager,
    settingsManager: SettingsManager.inMemory({
      retry: { enabled: false },
      compaction: { enabled: false },
    }),
    noTools: 'builtin',
    customTools: [read],
  });
  // Dispose before removing the temporary tree.
  cleanups.unshift(() => session.dispose());
  const addReads = (start: number, count: number) => {
    for (let i = start; i < start + count; i++)
      plans.push(
        reply([{ type: 'toolCall', id: `r${i}`, name: 'read', arguments: { path: `f${i}` } }])
      );
    plans.push(reply([{ type: 'text', text: 'Read complete.' }]));
  };
  const answer = () => plans.push(reply([{ type: 'text', text: 'Done.' }]));
  const cool = () => {
    skew += MICROCOMPACT_IDLE_MS + 1000;
  };
  const editEntries = () => manager.getBranch().filter((e) => e.type === 'context_edit');
  return { session, manager, requests, options, addReads, answer, cool, editEntries };
}

it('SDK next request uses placeholder while raw disk/history/display retain original; restart retains projection', async () => {
  const f = await fixture();
  f.addReads(0, 6);
  await f.session.prompt('Read six fixture files.');
  expect(JSON.stringify(f.requests.at(-1)!.messages)).toContain(body('f0'));
  f.cool();
  f.answer();
  await f.session.prompt('Continue after idle.');
  const sent = JSON.stringify(f.requests.at(-1)!.messages);
  expect(sent).not.toContain(body('f0'));
  expect(sent).toContain(P);
  expect(sent).toContain(body('f1'));
  expect(f.editEntries()).toHaveLength(1);
  const file = f.manager.getSessionFile()!;
  expect(readFileSync(file, 'utf8')).toContain(body('f0'));
  const raw = f.manager.getBranch().filter((entry) => entry.type === 'message');
  expect(JSON.stringify(raw)).toContain(body('f0'));
  expect(JSON.stringify(buildSessionDisplayMessages(f.session))).toContain(body('f0'));
  const restarted = SessionManager.open(file);
  expect(JSON.stringify(restarted.buildSessionProjection().messages)).not.toContain(body('f0'));
  expect(JSON.stringify(restarted.buildSessionProjection().messages)).toContain(P);
  expect(collectMicrocompactStats(restarted.getBranch())).toEqual({
    results: 1,
    charsRemoved: body('f0').length - P.length,
  });
});

it('repeated turns do not duplicate persisted edits', async () => {
  const f = await fixture();
  f.addReads(0, 6);
  await f.session.prompt('Read.');
  f.cool();
  f.answer();
  await f.session.prompt('Idle return.');
  f.answer();
  await f.session.prompt('Again.');
  f.cool();
  f.answer();
  await f.session.prompt('Another idle return.');
  expect(f.editEntries()).toHaveLength(1);
  expect(JSON.stringify(f.requests.at(-1)!.messages)).not.toContain(body('f0'));
  expect(JSON.stringify(f.requests.at(-1)!.messages)).toContain(body('f1'));
});

it('live off prevents new selections but does not undo persisted replacements', async () => {
  const f = await fixture();
  f.addReads(0, 6);
  await f.session.prompt('Read.');
  f.cool();
  f.answer();
  await f.session.prompt('Idle return.');
  f.addReads(6, 2);
  await f.session.prompt('Read two more.');
  f.options.enabled = false;
  f.cool();
  f.answer();
  await f.session.prompt('Idle with setting off.');
  const sent = JSON.stringify(f.requests.at(-1)!.messages);
  expect(sent).not.toContain(body('f0'));
  expect(sent).toContain(P);
  expect(sent).toContain(body('f1'));
  expect(f.editEntries()).toHaveLength(1);
  f.options.enabled = true;
  f.cool();
  f.answer();
  await f.session.prompt('Idle with setting on.');
  expect(f.editEntries()).toHaveLength(3);
  expect(JSON.stringify(f.requests.at(-1)!.messages)).not.toContain(body('f1'));
});
