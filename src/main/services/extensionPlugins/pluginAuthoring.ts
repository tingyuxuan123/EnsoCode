import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync, type Stats } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type {
  PluginAuthoringCreateResult,
  PluginAuthoringDraft,
  PluginAuthoringValidationResult,
} from '@shared/extensionPlugins/types';
import declarations from '../../../../examples/plugins/starter/enso-plugin.d.ts?raw';
import manifestText from '../../../../examples/plugins/starter/enso-plugin.json?raw';
import jsconfig from '../../../../examples/plugins/starter/jsconfig.json?raw';
import main from '../../../../examples/plugins/starter/main.mjs?raw';
import ui from '../../../../examples/plugins/starter/ui.js?raw';
import { samePluginFile, validatePluginDirectory, writePluginStarter } from './authoringFiles';
import { MANIFEST_FILE } from './install';
import type { ExtensionPluginService } from './service';

const starter = {
  'main.mjs': main,
  'ui.js': ui,
  'jsconfig.json': jsconfig,
  'enso-plugin.d.ts': declarations,
};
type Workspace = { cwd: string; projectId: string };
type BoundWorkspace = Workspace & { root: string; identity: Stats };
type DraftRecord = {
  owner: number;
  workspace: BoundWorkspace;
  draft: PluginAuthoringDraft;
  identity: Stats;
};
const unavailable = '本地 Code 会话的工作区不可用或已切换。';
const draftUnavailable = '插件草稿与当前会话或工作区不匹配，请从扩展页重新打开制作入口。';

/** Main owns the directory binding. Closing the window forgets the binding, not the user's source. */
export class PluginAuthoring {
  private readonly drafts = new Map<string, DraftRecord>();
  private readonly creating = new Set<string>();

  constructor(
    private readonly options: {
      workspace(sessionId: string): Workspace | null;
      hostVersion: string;
    }
  ) {}

  private workspace(sessionId: string): BoundWorkspace {
    const workspace = this.options.workspace(sessionId);
    if (!workspace || !isAbsolute(workspace.cwd)) throw new Error(unavailable);
    const root = realpathSync(workspace.cwd);
    const identity = lstatSync(root);
    if (!identity.isDirectory()) throw new Error(unavailable);
    return { ...workspace, root, identity };
  }

  private assertWorkspace(sessionId: string, expected: BoundWorkspace, signal?: AbortSignal): void {
    signal?.throwIfAborted();
    const current = this.workspace(sessionId);
    if (
      current.projectId !== expected.projectId ||
      current.cwd !== expected.cwd ||
      current.root !== expected.root ||
      !samePluginFile(current.identity, expected.identity)
    )
      throw new Error(unavailable);
  }

  private directory(record: DraftRecord): string {
    const path = join(record.workspace.root, record.draft.directory);
    const current = lstatSync(path);
    if (
      !current.isDirectory() ||
      !samePluginFile(current, record.identity) ||
      realpathSync(path) !== path
    )
      throw new Error(draftUnavailable);
    return path;
  }

  async create(
    owner: number,
    sessionId: string,
    signal?: AbortSignal
  ): Promise<PluginAuthoringCreateResult> {
    const key = `${owner}:${sessionId}`;
    if (this.creating.has(key)) return { ok: false, error: '插件草稿正在创建，请稍候。' };
    this.creating.add(key);
    try {
      signal?.throwIfAborted();
      const workspace = this.workspace(sessionId);
      const existing = this.drafts.get(key);
      if (
        existing &&
        existing.workspace.cwd === workspace.cwd &&
        existing.workspace.projectId === workspace.projectId &&
        existing.workspace.root === workspace.root &&
        samePluginFile(existing.workspace.identity, workspace.identity)
      ) {
        // A missing or replaced target is an explicit failure, not an invitation to overwrite.
        this.directory(existing);
        return { ok: true, draft: existing.draft };
      }
      const slug = randomUUID().replaceAll('-', '').slice(0, 24);
      const draft = { id: `local.draft${slug}`, directory: `plugin-${slug}` };
      const identity = await writePluginStarter({
        directory: join(workspace.root, draft.directory),
        id: draft.id,
        hostVersion: this.options.hostVersion,
        manifestText,
        read: (name) => starter[name],
        assertWorkspace: () => this.assertWorkspace(sessionId, workspace, signal),
      });
      this.drafts.delete(key);
      this.drafts.set(key, { owner, workspace, draft, identity });
      if (this.drafts.size > 64) {
        const oldest = this.drafts.keys().next().value;
        if (oldest !== undefined) this.drafts.delete(oldest);
      }
      return { ok: true, draft };
    } finally {
      this.creating.delete(key);
    }
  }

  private boundDraft(owner: number, sessionId: string, id: string, signal?: AbortSignal) {
    const key = `${owner}:${sessionId}`;
    const record = this.drafts.get(key);
    if (!record || record.draft.id !== id) throw new Error(draftUnavailable);
    const assertCurrent = () => {
      if (this.drafts.get(key) !== record) throw new Error(draftUnavailable);
      this.assertWorkspace(sessionId, record.workspace, signal);
      return this.directory(record);
    };
    const path = assertCurrent();
    // Authoring always starts from the manifest at the root, not a nested package fallback.
    if (!lstatSync(join(path, MANIFEST_FILE)).isFile())
      throw new Error('插件根目录缺少有效的清单。');
    return { path, assertCurrent };
  }

  async validate(
    owner: number,
    sessionId: string,
    id: string,
    signal?: AbortSignal
  ): Promise<PluginAuthoringValidationResult> {
    const { path, assertCurrent } = this.boundDraft(owner, sessionId, id, signal);
    const result = await validatePluginDirectory(path, this.options.hostVersion, signal);
    assertCurrent();
    if (!result.ok) return result;
    const { manifest, warnings } = result;
    if (manifest.id !== id) return { ok: false, error: '插件 ID 已变更，请恢复原草稿 ID。' };
    return { ok: true, name: manifest.name, version: manifest.version, warnings };
  }

  async stage(
    owner: number,
    sessionId: string,
    id: string,
    service: Pick<ExtensionPluginService, 'stage' | 'discard'>,
    signal?: AbortSignal
  ) {
    const { path, assertCurrent } = this.boundDraft(owner, sessionId, id, signal);
    const result = await service.stage({ kind: 'dir', path }, owner, signal);
    if (!result.ok) return result;
    try {
      assertCurrent();
      if (result.preview.id !== id) throw new Error('插件 ID 已变更，请恢复原草稿 ID。');
      return result;
    } catch (error) {
      service.discard(result.preview.token, owner);
      throw error;
    }
  }

  releaseOwner(owner: number): void {
    for (const [key, record] of this.drafts) if (record.owner === owner) this.drafts.delete(key);
  }
}
