import { assertDesignArchivePath } from '@shared/design/archive';
import type { DesignRootInfo, DesignRootRef } from '@shared/types/design';
import { addSidePanelDesign } from '@/lib/sidePanelDock';
import { useSessionsStore } from '@/stores/sessions';
import { useSettingsStore } from '@/stores/settings';
import type { PluginPreviewFile } from '../vetta/sdk/ui';
import { setPendingDesignPath } from '../vetta/src/canvas/design-runtime';
import {
  importPackagedVetd,
  type PackagedVetd,
  parseDesignManifest,
} from '../vetta/src/export/import-design';
import { migrateLegacyDesign } from '../vetta/src/vetd/migrate';
import { viewedDesignSessionId } from './activity-route';
import { createDesignContext, unwrap } from './context';
import { bindDesignContextOwner } from './owned-context';
import { resolveDesignRoot } from './paths';
import { translate } from './translation';
import type { PluginContext } from './types';

const MAX_BYTES = 32 * 1024 * 1024;
export function isDesignPreviewRel(rel: string): boolean {
  return /\.(vetdz|vetd)$/i.test(rel);
}
export interface DesignPreviewActions {
  openCanvas(): Promise<void>;
  importPackage(packaged: PackagedVetd): Promise<string>;
}
export interface LoadedDesignPreview {
  file: PluginPreviewFile;
  actions: DesignPreviewActions;
  dispose(): void;
}
function enabled(): void {
  if (!useSettingsStore.getState().designEnabled) throw new Error('Design is disabled');
}
function selected(owner: string): void {
  enabled();
  const state = useSessionsStore.getState();
  if (viewedDesignSessionId(state.conversations, state.activeId) !== owner)
    throw new Error('Select the file’s owning conversation before opening or importing its design');
}
async function ownerRoot(owner: string): Promise<DesignRootInfo> {
  enabled();
  const root = await resolveDesignRoot({ kind: 'session', sessionId: owner });
  if (root.ref.kind !== 'session' || root.ref.sessionId !== owner)
    throw new Error('Mismatched design root identity');
  return root;
}
function absolute(root: DesignRootInfo, rel: string): string {
  assertDesignArchivePath(rel);
  return `${root.path.replace(/\/$/, '')}/${rel}`;
}
async function verifyOwner(owner: string, root: DesignRootInfo): Promise<void> {
  selected(owner);
  if ((await ownerRoot(owner)).path !== root.path) throw new Error('Design workspace changed');
  selected(owner); // Selection can change while resolveRoot is in flight.
}
function reveal(owner: string, root: DesignRootInfo, path: string): void {
  selected(owner);
  if (!path.startsWith(`${root.path.replace(/\/$/, '')}/`))
    throw new Error('Design outside owner root');
  setPendingDesignPath(path, root.path);
  addSidePanelDesign({ conversationId: owner, title: translate('tab.label'), width: 'max' });
}

/** Never use DesignPaths' longest-root fallback for file actions: pin the original session ref. */
function boundContext(
  owner: string,
  root: DesignRootInfo,
  validate = () => verifyOwner(owner, root)
): PluginContext {
  const ctx = createDesignContext();
  const ref: DesignRootRef = { kind: 'session', sessionId: owner };
  const relative = (path: string) => {
    const prefix = `${root.path.replace(/\/$/, '')}/`;
    if (!path.startsWith(prefix)) throw new Error('Design outside owner root');
    const rel = path.slice(prefix.length);
    assertDesignArchivePath(rel);
    return rel;
  };
  const fs: PluginContext['fs'] = {
    ...ctx.fs,
    async stat(path) {
      await validate();
      const result = unwrap(
        await window.electronAPI.design.fs({ op: 'stat', root: ref, rel: relative(path) })
      );
      if (!('stat' in result)) throw new Error('Missing file stat');
      return result.stat;
    },
    async readFile(path) {
      await validate();
      const result = unwrap(
        await window.electronAPI.design.fs({ op: 'readFile', root: ref, rel: relative(path) })
      );
      if (!('content' in result)) throw new Error('Missing file content');
      return { content: result.content, encoding: result.encoding };
    },
    async writeFile(path, content, encoding = 'utf8') {
      await validate();
      unwrap(
        await window.electronAPI.design.fs({
          op: 'writeFile',
          root: ref,
          rel: relative(path),
          content,
          encoding,
        })
      );
    },
    async delete(path) {
      await validate();
      unwrap(await window.electronAPI.design.fs({ op: 'delete', root: ref, rel: relative(path) }));
    },
    async rename(from, to) {
      await validate();
      unwrap(
        await window.electronAPI.design.fs({
          op: 'rename',
          root: ref,
          from: relative(from),
          to: relative(to),
        })
      );
    },
    async createDirectory(path) {
      await validate();
      unwrap(
        await window.electronAPI.design.fs({
          op: 'createDirectory',
          root: ref,
          rel: relative(path),
        })
      );
    },
  };
  const bound = { ...ctx, fs };
  bindDesignContextOwner(bound, { root, validate });
  return bound;
}

/** Local files only. Main enforces the binary limit; Renderer verifies before allocating a Blob. */
export async function loadDesignPreviewFile(
  owner: string,
  rel: string
): Promise<LoadedDesignPreview> {
  assertDesignArchivePath(rel);
  if (!isDesignPreviewRel(rel)) throw new Error('Unsupported design preview');
  const root = await ownerRoot(owner);
  const result = unwrap(
    await window.electronAPI.design.fs({
      op: 'readBinaryFile',
      root: { kind: 'session', sessionId: owner },
      rel,
    })
  );
  if (
    !('data' in result) ||
    result.size > MAX_BYTES ||
    result.data.length > Math.ceil(MAX_BYTES / 3) * 4
  )
    throw new Error('Design preview exceeds size limit');
  const binary = atob(result.data);
  if (binary.length !== result.size || binary.length > MAX_BYTES)
    throw new Error('Invalid preview bytes');
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  let disposed = false;
  const guard = async () => {
    if (disposed) throw new Error('Design preview closed');
    await verifyOwner(owner, root);
    if (disposed) throw new Error('Design preview closed');
  };
  const file: PluginPreviewFile = {
    path: absolute(root, rel),
    name: rel.split('/').pop() ?? rel,
    extension: rel.split('.').pop()?.toLowerCase() ?? '',
    mime: result.mimeType,
    size: bytes.length,
    readText: async () => new TextDecoder().decode(bytes),
    readBytes: async () => bytes.slice().buffer,
    getUrl: () => (disposed ? '' : url),
    watch: () => ({ dispose() {} }),
  };
  return {
    file,
    actions: {
      async openCanvas() {
        await guard();
        // This action exists only for validated legacy JSON, not .vetdz/legacy ZIP shares.
        if (!/\.vetd$/i.test(rel)) throw new Error('A share file must be imported first');
        const ctx = boundContext(owner, root, guard);
        parseDesignManifest((await ctx.fs.readFile(absolute(root, rel))).content);
        await migrateLegacyDesign(ctx.fs, absolute(root, rel));
        await guard();
        reveal(owner, root, absolute(root, rel));
      },
      async importPackage(packaged) {
        await guard();
        const path = await importPackagedVetd(
          boundContext(owner, root, guard),
          packaged,
          absolute(root, rel).slice(0, absolute(root, rel).lastIndexOf('/')),
          file.name
        );
        await guard();
        reveal(owner, root, path);
        return path;
      },
    },
    dispose() {
      if (!disposed) {
        disposed = true;
        URL.revokeObjectURL(url);
      }
    },
  };
}

export async function openDesignDirectory(owner: string, rel: string): Promise<void> {
  assertDesignArchivePath(rel);
  if (!/\.vetd$/i.test(rel)) throw new Error('Expected a design bundle');
  selected(owner);
  const root = await ownerRoot(owner);
  await verifyOwner(owner, root);
  reveal(owner, root, absolute(root, rel));
}
