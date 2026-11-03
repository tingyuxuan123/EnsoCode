import type { PluginPreviewFile } from '@vetta-org/plugin-sdk';
import { strToU8, zipSync } from 'fflate';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { VetdPreview } from '../src/preview/VetdPreview';

const i18n = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock('@vetta-org/plugin-sdk', () => ({ useTranslation: () => ({ locale: 'zh', t: i18n.t }) }));
vi.mock('../src/preview/PreviewCanvas', () => ({ PreviewCanvas: () => <div data-preview-canvas="" /> }));
vi.mock('../src/preview/snapshot-assets', () => ({ inlineSnapshotAssets: async (html: string) => html }));
vi.mock('@/components/chat/ConfirmDialog', () => ({ ConfirmDialog: ({ open, description, onConfirm }: { open: boolean; description: ReactNode; onConfirm: () => void }) => open ? <div data-confirm="">{description}<button type="button" onClick={onConfirm}>confirm</button></div> : null }));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function file(bytes: Uint8Array, extension = 'vetd'): PluginPreviewFile {
  return { path: '/canonical/share.vetd', name: `share.${extension}`, extension, size: bytes.length, mime: 'application/octet-stream',
    readBytes: async () => bytes.slice().buffer as ArrayBuffer, readText: async () => new TextDecoder().decode(bytes), getUrl: () => 'blob:share', watch: () => ({ dispose() {} }) };
}
function share() {
  return zipSync({ 'manifest.json': strToU8('{"version":1,"type":"vetta-design","frames":[]}'), 'snapshot.html': strToU8('<html></html>') });
}
it('legacy .vetd ZIP和.vetdz均可预览，Import之前明确确认本机执行代码/npm风险', async () => {
  const importPackage = vi.fn(async () => '/canonical/new.vetd');
  await act(async () => root.render(<VetdPreview file={file(share())} actions={{ openCanvas: vi.fn(), importPackage }} />));
  expect(container.querySelector('[data-preview-canvas]')).not.toBeNull();
  expect(importPackage).not.toHaveBeenCalled();
  const button = [...container.querySelectorAll('button')].find((item) => item.textContent === 'preview.import');
  await act(async () => button?.click());
  expect(container.querySelector('[data-confirm]')?.textContent).toContain('npm');
  expect(container.querySelector('[data-confirm]')?.textContent).toContain('本机代码');
  expect(importPackage).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLButtonElement>('[data-confirm] button')?.click());
  expect(importPackage).toHaveBeenCalledOnce();
});
it('旧JSON工作文件可打开画布，JSON伪装.vetdz或损坏zip都不可导入', async () => {
  const openCanvas = vi.fn();
  const manifest = strToU8('{"version":1,"type":"vetta-design","frames":[]}');
  await act(async () => root.render(<VetdPreview file={file(manifest)} actions={{ openCanvas, importPackage: vi.fn() }} />));
  expect(container.textContent).toContain('preview.working.badge');
  for (const source of [file(manifest, 'vetdz'), file(strToU8('PK-corrupt'), 'vetdz')]) {
    await act(async () => root.render(<VetdPreview file={source} actions={{ openCanvas, importPackage: vi.fn() }} />));
    expect(container.textContent).toBe('preview.invalid');
    expect(container.querySelector('[data-preview-canvas]')).toBeNull();
  }
});
