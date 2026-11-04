import type { DesignRootRef } from '@shared/types/design';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDesignPreviewFile, openDesignDirectory } from './preview-files';

const h = vi.hoisted(() => ({
  activeId: 'owner',
  rootPath: '/canonical/project',
  enabled: true,
  fs: vi.fn(),
  reveal: vi.fn(),
  pending: vi.fn(),
  resolve: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock('@/stores/sessions', () => ({
  useSessionsStore: {
    getState: () => ({
      activeId: h.activeId,
      conversations: { owner: { projectId: 'p' }, other: { projectId: 'q' } },
    }),
  },
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: { getState: () => ({ designEnabled: h.enabled }) },
}));
vi.mock('@/lib/sidePanelDock', () => ({ addSidePanelDesign: h.reveal }));
vi.mock('./context', () => ({
  createDesignContext: () => ({ fs: {}, ui: {} }),
  unwrap: (value: unknown) => value,
}));
vi.mock('./paths', () => ({ resolveDesignRoot: h.resolve }));
vi.mock('../vetta/src/canvas/design-runtime', () => ({ setPendingDesignPath: h.pending }));
vi.mock('./translation', () => ({ translate: (key: string) => key }));

beforeEach(() => {
  vi.clearAllMocks();
  h.activeId = 'owner';
  h.rootPath = '/canonical/project';
  h.enabled = true;
  h.resolve.mockImplementation(async (ref: DesignRootRef) => ({ ref, path: h.rootPath }));
  h.fs.mockResolvedValue({
    ok: true,
    data: btoa('bytes'),
    size: 5,
    mimeType: 'application/octet-stream',
  });
  vi.stubGlobal('window', { electronAPI: { design: { fs: h.fs } } });
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:owned', revokeObjectURL: h.revoke });
});

describe('设计文件预览的权威根和所属会话', () => {
  it.each(['C:/项目', 'C:/'])(
    'Windows %s preview/import/open keep SDK paths and ref+rel IPC',
    async (root) => {
      h.rootPath = root;
      const base = root.replace(/\/$/, '');
      const loaded = await loadDesignPreviewFile('owner', '设计.vetdz');
      expect(loaded.file.path).toBe(`${base}/设计.vetdz`);
      expect(h.fs).toHaveBeenLastCalledWith({
        op: 'readBinaryFile',
        root: { kind: 'session', sessionId: 'owner' },
        rel: '设计.vetdz',
      });
      h.fs.mockImplementation(async (request: { op: string }) =>
        request.op === 'stat' ? { ok: true, stat: null } : { ok: true }
      );
      expect(
        await loaded.actions.importPackage({
          manifestJson: '{"version":1,"type":"vetta-design","frames":[]}',
          designFiles: new Map(),
          snapshotHtml: null,
          historyZip: null,
        })
      ).toBe(`${base}/设计.vetd`);
      expect(h.fs).toHaveBeenLastCalledWith({
        op: 'writeFile',
        root: { kind: 'session', sessionId: 'owner' },
        rel: '设计.vetd/design.json',
        content: expect.any(String),
        encoding: 'utf8',
      });
      expect(h.pending).toHaveBeenLastCalledWith(`${base}/设计.vetd`, root);
      await openDesignDirectory('owner', '目录/设计.vetd');
      expect(h.pending).toHaveBeenLastCalledWith(`${base}/目录/设计.vetd`, root);
      loaded.dispose();
    }
  );
  it('先resolveRoot，按session标识读取二进制，PluginPreviewFile展示规范路径且释放URL幂等', async () => {
    const loaded = await loadDesignPreviewFile('owner', 'nested/share.vetdz');
    expect(h.fs).toHaveBeenCalledWith({
      op: 'readBinaryFile',
      root: { kind: 'session', sessionId: 'owner' },
      rel: 'nested/share.vetdz',
    });
    expect(loaded.file.path).toBe('/canonical/project/nested/share.vetdz');
    expect(loaded.file.getUrl()).toBe('blob:owned');
    loaded.dispose();
    loaded.dispose();
    expect(h.revoke).toHaveBeenCalledExactlyOnceWith('blob:owned');
  });
  it('不是当前选中的owner不能写入或打开，不能借当前会话替代owner', async () => {
    const loaded = await loadDesignPreviewFile('owner', 'share.vetd');
    h.activeId = 'other';
    h.fs.mockClear();
    await expect(
      loaded.actions.importPackage({
        manifestJson: '{"version":1,"type":"vetta-design","frames":[]}',
        designFiles: new Map(),
        snapshotHtml: null,
        historyZip: null,
      })
    ).rejects.toThrow();
    await expect(loaded.actions.openCanvas()).rejects.toThrow();
    expect(h.fs).not.toHaveBeenCalled();
    expect(h.reveal).not.toHaveBeenCalled();
    expect(h.pending).not.toHaveBeenCalled();
  });
  it('root/worktree在加载后变化则拒绝迟到操作', async () => {
    const loaded = await loadDesignPreviewFile('owner', 'share.vetd');
    h.rootPath = '/changed/worktree';
    h.fs.mockClear();
    await expect(loaded.actions.openCanvas()).rejects.toThrow();
    expect(h.fs).not.toHaveBeenCalled();
    expect(h.reveal).not.toHaveBeenCalled();
  });
  it('目录打开只设置cwd-scoped pending并显式绑定owner dock', async () => {
    await openDesignDirectory('owner', 'nested/app.vetd');
    expect(h.pending).toHaveBeenCalledWith(
      '/canonical/project/nested/app.vetd',
      '/canonical/project'
    );
    expect(h.reveal).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'owner' }));
  });
  it('导入写入始终使用原始session root，不会借同cwd其它会话的路径映射', async () => {
    const loaded = await loadDesignPreviewFile('owner', 'share.vetdz');
    h.fs.mockImplementation(async (request: { op: string }) =>
      request.op === 'stat' ? { ok: true, stat: null } : { ok: true }
    );
    await loaded.actions.importPackage({
      manifestJson: '{"version":1,"type":"vetta-design","frames":[]}',
      designFiles: new Map([['theme.css', new Uint8Array([97])]]),
      snapshotHtml: null,
      historyZip: null,
    });
    const writes = h.fs.mock.calls
      .map(([request]) => request)
      .filter((request) => request.op === 'writeFile');
    expect(writes.length).toBe(2);
    expect(
      writes.every(
        (request) =>
          request.root.kind === 'session' &&
          request.root.sessionId === 'owner' &&
          request.rel.startsWith('share.vetd/')
      )
    ).toBe(true);
    expect(h.pending).toHaveBeenCalledWith('/canonical/project/share.vetd', '/canonical/project');
  });
  it('stat等待中迁移工作区或卸载后，不继续写入新根', async () => {
    for (const close of [false, true]) {
      h.rootPath = '/canonical/project';
      h.fs.mockResolvedValue({
        ok: true,
        data: btoa('bytes'),
        size: 5,
        mimeType: 'application/octet-stream',
      });
      const loaded = await loadDesignPreviewFile('owner', 'share.vetdz');
      h.fs.mockImplementation(async (request: { op: string }) => {
        if (request.op === 'stat') {
          if (close) loaded.dispose();
          else h.rootPath = '/moved';
          return { ok: true, stat: null };
        }
        return { ok: true };
      });
      await expect(
        loaded.actions.importPackage({
          manifestJson: '{"version":1,"type":"vetta-design","frames":[]}',
          designFiles: new Map([['theme.css', new Uint8Array([97])]]),
          snapshotHtml: null,
          historyZip: null,
        })
      ).rejects.toThrow();
      expect(h.fs.mock.calls.some(([request]) => request.op === 'writeFile')).toBe(false);
      h.fs.mockClear();
    }
  });
  it('关闭功能和非法相对路径不能调用读取IPC', async () => {
    await expect(loadDesignPreviewFile('owner', '../share.vetdz')).rejects.toThrow();
    h.enabled = false;
    await expect(loadDesignPreviewFile('owner', 'share.vetdz')).rejects.toThrow();
    expect(h.fs).not.toHaveBeenCalled();
  });
});
