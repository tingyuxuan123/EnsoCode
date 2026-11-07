import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createAssistantMessageEventStream,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from '@earendil-works/pi-ai';
import { getModel } from '@earendil-works/pi-ai/compat';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { parseSkillInvocation, restoreSkillCommands } from '@shared/skillCommands';
import { afterEach, expect, it, vi } from 'vitest';
import { PROJECTED_TEXT_LIMIT, projectMessage } from './projection';
import { skillChainExtension } from './skillChainExtension';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
});

async function harness(names = ['a', 'b']) {
  const root = mkdtempSync(join(tmpdir(), 'enso-skills-sdk-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const skillPaths = names.map((name, index) => {
    const dir = join(root, `skill-${index}`);
    mkdirSync(dir);
    const file = join(dir, 'SKILL.md');
    writeFileSync(
      file,
      `---\nname: ${JSON.stringify(name)}\ndescription: skill fixture\n---\nBody ${name}`
    );
    return file;
  });
  const plugin = join(root, 'plugin.mjs');
  writeFileSync(
    plugin,
    `export default (pi) => { pi.on('input', (event) => {
    if (event.text === '/handled') return { action: 'handled' };
    if (event.text === '/transform') return { action: 'transform', text: '/skill:b /skill:a transformed' };
    return { action: 'continue' };
  }); };`
  );
  const loader = new DefaultResourceLoader({
    cwd: root,
    agentDir: join(root, 'agent'),
    noExtensions: true,
    additionalExtensionPaths: [plugin],
    noSkills: true,
    additionalSkillPaths: skillPaths,
    noPromptTemplates: true,
    noContextFiles: true,
    noThemes: true,
    extensionFactories: [skillChainExtension(() => loader.getSkills().skills)],
  });
  await loader.reload();
  expect(loader.getExtensions().errors).toEqual([]);
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
  });
  vi.spyOn(runtime, 'hasConfiguredAuth').mockReturnValue(true);
  const stream = vi.spyOn(runtime, 'streamSimple').mockImplementation((model) => {
    const output = createAssistantMessageEventStream();
    output.push({
      type: 'done',
      reason: 'stop',
      message: {
        role: 'assistant',
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: [{ type: 'text', text: 'ok' }],
        stopReason: 'stop',
        timestamp: Date.now(),
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      },
    });
    return output;
  });
  const model = getModel('openai', 'gpt-4o-mini');
  if (!model) throw new Error('Bundled model missing');
  const manager = SessionManager.inMemory(root);
  const { session } = await createAgentSession({
    cwd: root,
    agentDir: join(root, 'agent'),
    modelRuntime: runtime,
    model,
    thinkingLevel: 'off',
    sessionManager: manager,
    resourceLoader: loader,
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    }),
    noTools: 'builtin',
  });
  cleanups.push(() => session.dispose());
  const users = () =>
    session.messages
      .filter((message) => message.role === 'user')
      .map((message) =>
        typeof message.content === 'string'
          ? message.content
          : message.content.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('')
      );
  return { session, loader, stream, users };
}

it('真实pi1.4 loader保证磁盘插件先transform，链扩展最后执行且权威user只落盘一次', async () => {
  const { session, loader, users, stream } = await harness();
  expect(
    loader
      .getExtensions()
      .extensions.map((extension) => extension.path)
      .at(-1)
  ).toBe('<inline:skill-chain>');
  await session.prompt('/transform');
  expect(stream).toHaveBeenCalledTimes(1);
  expect(users()).toHaveLength(1);
  expect(parseSkillInvocation(users()[0]!)?.blocks.map((block) => block.name)).toEqual(['b', 'a']);
  expect(restoreSkillCommands(users()[0]!)).toBe('/skill:b /skill:a transformed');
});

it('真实input handled阻止prompt和steer，不产生权威user或残留队列', async () => {
  const { session, stream, users } = await harness();
  await session.prompt('/handled');
  expect(await session.steer('/handled')).toBe('handled');
  expect(stream).not.toHaveBeenCalled();
  expect(users()).toEqual([]);
  expect(session.getSteeringMessages()).toEqual([]);
});

it('真实steer不丢弃图像参数，原生单技能仍由pi展开且不添加新属性', async () => {
  const { session, users } = await harness();
  const images = [
    { type: 'image' as const, data: 'not-read-until-delivery', mimeType: 'image/png' },
  ];
  const transformed = await session.extensionRunner.emitInput(
    '/skill:a /skill:b queued',
    images,
    'interactive'
  );
  expect(transformed).toMatchObject({ action: 'transform', images });
  const steer = vi.spyOn(session.agent, 'steer');
  await session.steer('/skill:a /skill:b queued', images);
  const queued = steer.mock.calls[0]?.[0];
  expect(queued?.role).toBe('user');
  if (queued?.role !== 'user') throw new Error('Expected queued user message');
  expect(queued.content).toEqual(expect.arrayContaining(images));
  expect(restoreSkillCommands(session.getSteeringMessages()[0]!)).toBe('/skill:a /skill:b queued');
  session.clearQueue();
  await session.prompt('/skill:a single');
  expect(users()[0]).not.toContain('content-length=');
  expect(restoreSkillCommands(users()[0]!)).toBe('/skill:a single');
});

it('真实loader仍加载warning名称，多链沿用其权威名称而不是收紧白名单', async () => {
  const names = ['中文', 'plugin:review.v2', 'a&"<>'];
  const { session, loader, users } = await harness(names);
  expect(loader.getSkills().skills.map((skill) => skill.name)).toEqual(names);
  const text = `${names.map((name) => `/skill:${name}`).join(' ')} 任务`;
  await session.prompt(text);
  expect(parseSkillInvocation(users()[0]!)?.blocks.map((block) => block.name)).toEqual(names);
  expect(restoreSkillCommands(users()[0]!)).toBe(text);
});

it('真实SDK不会二次展开，缺失/未知/重复前缀仍能恢复完整原命令', async () => {
  const { session, loader, users } = await harness();
  unlinkSync(loader.getSkills().skills.find((skill) => skill.name === 'a')!.filePath);
  const text = '/skill:a /skill:unknown /skill:b /skill:b 任务';
  await session.prompt(text);
  expect(users()).toHaveLength(1);
  expect(parseSkillInvocation(users()[0]!)?.blocks.map((block) => block.name)).toEqual(['b']);
  expect(users()[0]!.match(/Body b/g)).toHaveLength(1);
  expect(restoreSkillCommands(users()[0]!)).toBe(text);
});

it('并发补充各自保留技能次序，不共用去重缓存或重复展开另一条消息', async () => {
  const { session } = await harness();
  await Promise.all([
    session.steer('/skill:a /skill:b first'),
    session.steer('/skill:b /skill:a second'),
  ]);
  expect(session.getSteeringMessages().map(restoreSkillCommands)).toEqual([
    '/skill:a /skill:b first',
    '/skill:b /skill:a second',
  ]);
});

it('真实SDK生成40K技能链后投影仍可解析并回退原任务，jsonl权威正文不被裁', async () => {
  const { session, loader, users } = await harness();
  for (const skill of loader.getSkills().skills)
    writeFileSync(skill.filePath, skill.name.repeat(20000));
  await session.prompt('/skill:a /skill:b 原任务');
  const authority = users()[0]!;
  expect(authority.length).toBeGreaterThan(40000);
  const projected = projectMessage(session.messages.find((message) => message.role === 'user'));
  const part = projected?.content[0];
  if (part?.type !== 'text') throw new Error('Expected text projection');
  expect(part.text.length).toBeLessThanOrEqual(PROJECTED_TEXT_LIMIT);
  expect(parseSkillInvocation(part.text)?.blocks).toHaveLength(2);
  expect(restoreSkillCommands(part.text)).toBe('/skill:a /skill:b 原任务');
  expect(users()[0]).toBe(authority);
});

it.each(['<role>\ninternal\n</role>\n\n', '<plan-mode>\nPlan mode is ON\n</plan-mode>\n\n'])(
  '真实SDK前缀%s后单技能可展开，权威消息保持前缀',
  async (prefix) => {
    const { session, users } = await harness();
    await session.prompt(`${prefix}/skill:a 原任务`);
    expect(users()[0]!.startsWith(prefix)).toBe(true);
    expect(parseSkillInvocation(users()[0]!)?.blocks.map((block) => block.name)).toEqual(['a']);
    expect(restoreSkillCommands(users()[0]!)).toBe('/skill:a 原任务');
  }
);
