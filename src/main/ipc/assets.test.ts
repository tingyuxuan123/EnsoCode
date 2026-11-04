import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IPC_CHANNELS } from '@shared/types';
import type { ProjectAuthority } from '@shared/types/agent';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerAssetHandlers } from './assets';

const mocks = vi.hoisted(() => ({
  handle: vi.fn(),
  project: vi.fn<(id: string) => ProjectAuthority | undefined>(),
  settings: vi.fn<() => Record<string, unknown> | undefined>(),
  root: '',
}));

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => mocks.root, getPath: () => mocks.root },
  ipcMain: { handle: mocks.handle },
}));
vi.mock('./agent', () => ({ getSourceAuthorityRegistry: () => ({ project: mocks.project }) }));
vi.mock('./settings', () => ({ readSettings: vi.fn() }));
vi.mock('../services/agentHost', () => ({
  agentDataDir: () => path.join(mocks.root, 'agent'),
  customWorkflowPresetDir: vi.fn(),
  readSettingsState: mocks.settings,
}));

let projectRoot: string;
const projectId = 'new-project';
const design = { name: 'vetta-ui-design', description: 'Design canvas' };

beforeEach(() => {
  mocks.root = mkdtempSync(path.join(tmpdir(), 'enso-skill-preview-'));
  projectRoot = path.join(mocks.root, 'project');
  const home = path.join(mocks.root, 'home');
  const skill = path.join(mocks.root, 'resources/design/skills', design.name);
  for (const dir of [projectRoot, home, skill]) mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(skill, 'SKILL.md'),
    `---\nname: ${design.name}\ndescription: ${design.description}\n---\n`
  );
  vi.stubEnv('HOME', home);
  mocks.handle.mockClear();
  mocks.settings.mockReset();
  mocks.project.mockImplementation((id) =>
    id === projectId
      ? { projectId, canonicalPath: projectRoot, kind: 'local', state: 'active', version: 1 }
      : undefined
  );
  registerAssetHandlers();
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(mocks.root, { recursive: true, force: true });
});

async function preview(id: unknown = projectId): Promise<unknown> {
  const handler = mocks.handle.mock.calls.find(
    ([channel]) => channel === IPC_CHANNELS.ASSETS_LIST_PROJECT_SKILLS
  )?.[1];
  return handler({}, id);
}

it('新项目未启动 worker 时就从内置资源返回设计技能', async () => {
  expect(await preview()).toContainEqual(design);
});

it('项目本地技能扫描关闭后仍可发现设计技能；设计功能关闭后不再预览', async () => {
  mocks.settings.mockReturnValue({ loadLocalSkills: false });
  expect(await preview()).toEqual([design]);
  mocks.settings.mockReturnValue({ loadLocalSkills: false, designEnabled: false });
  expect(await preview()).toEqual([]);
});

it('不把 Renderer 提供的路径或 SSH 项目当成本机项目', async () => {
  expect(await preview(projectRoot)).toEqual([]);
  mocks.project.mockReturnValue({
    projectId,
    canonicalPath: projectRoot,
    kind: 'ssh',
    state: 'active',
    version: 1,
  });
  expect(await preview()).toEqual([]);
});

it('临时会话只列内置技能，不扫描 scratch 共用父目录', async () => {
  const local = path.join(projectRoot, '.agents/skills/other-chat-skill');
  mkdirSync(local, { recursive: true });
  writeFileSync(
    path.join(local, 'SKILL.md'),
    '---\nname: other-chat-skill\ndescription: private\n---\n'
  );
  mocks.project.mockReturnValue({
    projectId,
    canonicalPath: projectRoot,
    kind: 'scratch',
    state: 'active',
    version: 1,
  });
  expect(await preview()).toEqual([design]);
});
