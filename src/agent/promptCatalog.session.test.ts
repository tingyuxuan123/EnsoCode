import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  type AssistantMessage,
  getCurrentSystemPrompt,
  getCurrentTools,
  type TranscriptContext,
} from '@earendil-works/pi-ai';
import { getModel } from '@earendil-works/pi-ai/compat';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import {
  createAgentSession,
  createSyntheticSourceInfo,
  DefaultResourceLoader,
  type ExtensionAPI,
  type InlineExtension,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { replacePersonaParagraph } from '@shared/systemPrompt';
import { Type } from 'typebox';
import { afterEach, expect, it, vi } from 'vitest';
import { appendSystemPromptExtension, SUBAGENT_CONTRACT_PROMPT } from './childContract';
import { promptCatalogExtension } from './promptCatalog';
import { createCodeSearchTool } from './tools/codeSearch';

const model = getModel('openai', 'gpt-4o-mini');
if (!model) throw new Error('Test model is not available in the bundled Pi catalog.');
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

function tool(name: string): ToolDefinition {
  return {
    name,
    label: name,
    description: 'Fetch documentation. Longer details omitted by catalog.',
    namespace: { name: 'mcp__docs', description: 'Documentation server' },
    parameters: Type.Object({ query: Type.String() }),
    execute: async () => ({ content: [{ type: 'text', text: 'ok' }], details: undefined }),
  };
}

it.each([false, true])(
  '真 SDK 最终提示词保留完整技能、schema、选型指南与合同，persona=%s',
  async (persona) => {
    const root = mkdtempSync(path.join(tmpdir(), 'enso-prompt-catalog-'));
    const cwd = path.join(root, 'workspace');
    const agentDir = path.join(root, 'agent');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const runtime = await ModelRuntime.create({
      authPath: path.join(agentDir, 'auth.json'),
      modelsPath: path.join(agentDir, 'models.json'),
      refreshOnCreate: false,
    });
    vi.spyOn(runtime, 'hasConfiguredAuth').mockReturnValue(true);
    const requests: TranscriptContext[] = [];
    vi.spyOn(runtime, 'streamSimple').mockImplementation((_model, context) => {
      requests.push(structuredClone(context as TranscriptContext));
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
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
        stopReason: 'stop',
        timestamp: Date.now(),
      };
      stream.push({ type: 'done', reason: 'stop', message });
      return stream;
    });
    let api: ExtensionAPI | undefined;
    const skillDescription = `完整技能描述${'技能适用条件。'.repeat(80)}SKILL-END`;
    const extras = {
      security: 'SECURITY-UNCHANGED',
      browser: 'BROWSER-UNCHANGED',
      plan: 'PLAN-UNCHANGED',
      model_guide: 'MODEL-SELECTION-UNCHANGED',
    };
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPromptOverride: () => undefined,
      appendSystemPromptOverride: () => ['PRELUDE-UNCHANGED'],
      skillsOverride: () => ({
        skills: [
          {
            name: 'complete',
            description: skillDescription,
            filePath: path.join(root, 'SKILL.md'),
            baseDir: root,
            sourceInfo: createSyntheticSourceInfo('<inline:test>', { source: 'test' }),
            disableModelInvocation: false,
          },
        ],
        diagnostics: [],
      }),
      extensionFactories: [
        {
          name: 'fixture',
          factory: (pi) => {
            api = pi;
            pi.registerTool(tool('mcp__docs__get'));
            pi.on('before_agent_start', (event) => {
              Object.assign(event.systemPromptOptions.sections, extras);
              event.systemPromptOptions.promptGuidelines.push('MODEL-PROMPT-GUIDELINE');
            });
          },
        } satisfies InlineExtension,
        promptCatalogExtension,
        appendSystemPromptExtension('subagent-contract', SUBAGENT_CONTRACT_PROMPT),
        ...(persona
          ? [
              {
                name: 'custom-persona',
                factory: (pi) => {
                  pi.on('before_agent_start', (event) => ({
                    systemPrompt: replacePersonaParagraph(event.systemPrompt, 'CUSTOM-PERSONA'),
                  }));
                },
              } satisfies InlineExtension,
            ]
          : []),
      ],
    });
    await loader.reload();
    const codeSearch = createCodeSearchTool({
      run: async () => {
        throw new Error('not called');
      },
    });
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      modelRuntime: runtime,
      model,
      thinkingLevel: 'off',
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(cwd),
      settingsManager: SettingsManager.inMemory({
        retry: { enabled: false },
        compaction: { enabled: false },
      }),
      customTools: [codeSearch],
    });
    cleanups.unshift(() => session.dispose());
    session.setActiveToolsByName(['read', 'grep', 'code_search', 'mcp__docs__get']);
    await session.prompt('First turn');
    const prompt = getCurrentSystemPrompt(requests[0]!.messages);
    expect(prompt).toContain('<tool_catalog>');
    expect(prompt).toContain('- mcp__docs__get: Fetch documentation.');
    expect(prompt.match(/<tool_catalog>/g)).toHaveLength(1);
    expect(prompt).toContain(skillDescription);
    expect(prompt).toContain(path.join(root, 'SKILL.md'));
    expect(prompt).toContain(codeSearch.promptSnippet);
    for (const guideline of codeSearch.promptGuidelines ?? []) expect(prompt).toContain(guideline);
    for (const text of Object.values(extras)) expect(prompt).toContain(text);
    expect(prompt).toContain('MODEL-PROMPT-GUIDELINE');
    expect(prompt).toContain('PRELUDE-UNCHANGED');
    expect(prompt).toContain(SUBAGENT_CONTRACT_PROMPT);
    if (persona) expect(prompt).toMatch(/^CUSTOM-PERSONA/);
    const catalog = prompt.match(/<tool_catalog>([\s\S]*?)<\/tool_catalog>/)?.[1] ?? '';
    expect(catalog).not.toContain('- code_search:');
    expect(
      getCurrentTools(requests[0]!.messages).find((item) => item.name === 'mcp__docs__get')
        ?.parameters
    ).toEqual(JSON.parse(JSON.stringify(tool('mcp__docs__get').parameters)));

    api!.registerTool(tool('mcp__docs__search'));
    session.setActiveToolsByName(['read', 'grep', 'code_search', 'mcp__docs__search']);
    await session.prompt('Added and switched');
    const second = getCurrentSystemPrompt(requests[1]!.messages);
    expect(second).toContain('- mcp__docs__search:');
    expect(second).not.toContain('- mcp__docs__get:');
    api!.registerTool({ ...tool('mcp__docs__search'), exposure: 'hidden' });
    await session.prompt('Removed');
    expect(getCurrentSystemPrompt(requests[2]!.messages)).not.toContain('<tool_catalog>');
  }
);
