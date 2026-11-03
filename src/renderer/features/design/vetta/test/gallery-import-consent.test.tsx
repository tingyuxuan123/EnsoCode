import { strToU8, zipSync } from 'fflate';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  picked: [] as { name: string; data: string }[],
  create: vi.fn(async (_name: string) => ({ path: '/designs/imported' })),
  stat: vi.fn(async () => null),
  write: vi.fn(async () => {}),
  open: vi.fn(async () => {}),
  notify: vi.fn(),
}));
vi.mock('@vetta-org/plugin-sdk', () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t, locale: 'en' }) };
});
vi.mock('../src/plugin-context', () => ({
  getPluginCtx: () => ({
    official: { projects: { create: fake.create }, dialog: { openFiles: async () => fake.picked } },
    fs: { stat: fake.stat, writeFile: fake.write },
    ui: { setWorkspaceViewHeader: vi.fn() },
  }),
  notify: fake.notify,
}));
vi.mock('../src/design-systems/index', () => ({ refreshDesignCatalog: vi.fn() }));
vi.mock('../src/gallery/gallery-store', () => ({
  getCachedSnapshot: () => null,
  isGalleryAbortError: () => false,
  loadGallery: async () => ({ cards: [], workspacePath: '/designs' }),
}));
vi.mock('../src/gallery/GalleryHero', () => ({
  GalleryHero: ({ onImport }: { onImport(): void }) => <button type="button" onClick={onImport}>Pick import</button>,
}));
vi.mock('../src/gallery/DesignSystemGrid', () => ({ DesignSystemGrid: () => null }));
vi.mock('../src/gallery/open-project', () => ({ openProjectFromGallery: fake.open, startDesignProject: vi.fn() }));
vi.mock('../src/gallery/start-from-system', () => ({ startDesignFromSystem: vi.fn() }));
vi.mock('../src/gallery/use-gallery-columns', () => ({ useGalleryColumns: () => ({ ref: () => {}, columns: 3 }) }));

import { GalleryView } from '../src/gallery/GalleryView';
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: Root;
let host: HTMLDivElement;
const validBytes = () => zipSync({
  'manifest.json': strToU8(JSON.stringify({ version: 1, type: 'vetta-design', frames: [] })),
  'design/frames/index.tsx': strToU8('export default function Frame() { return <h1>Demo</h1>; }'),
});
const clickByText = async (text: string) => {
  const button = [...document.querySelectorAll('button')].find((element) => element.textContent === text);
  expect(button).toBeDefined();
  await act(async () => button?.click());
};
const drop = async (bytes: Uint8Array) => {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: [{ name: 'test.vetdz', arrayBuffer: async () => bytes.slice().buffer }] } });
  await act(async () => host.firstElementChild?.dispatchEvent(event));
};

beforeEach(async () => {
  vi.clearAllMocks();
  fake.picked = [{ name: 'test.vetdz', data: btoa(String.fromCharCode(...validBytes())) }];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<GalleryView />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('gallery import consent before executable project creation', () => {
  it('picker validates and warns before creating anything; rejecting never creates files or sessions', async () => {
    await clickByText('Pick import');
    expect(document.body.textContent).toContain('npm');
    expect(document.body.textContent).toContain('trusted');
    expect(fake.create).not.toHaveBeenCalled();
    expect(fake.write).not.toHaveBeenCalled();
    expect(fake.open).not.toHaveBeenCalled();
    await clickByText('gallery.action.cancel');
    expect(document.querySelector('[data-slot="dialog-popup"]')).toBeNull();
    expect(fake.create).not.toHaveBeenCalled();
    expect(fake.open).not.toHaveBeenCalled();
  });

  it('drop shares the same confirmation; accepting then imports and opens exactly one project', async () => {
    await drop(validBytes());
    expect(fake.create).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('npm');
    await clickByText('gallery.action.import');
    expect(fake.create).toHaveBeenCalledOnce();
    expect(fake.write).toHaveBeenCalled();
    expect(fake.open).toHaveBeenCalledWith({ cwd: '/designs/imported', vetdPath: '/designs/imported/test.vetd' });
  });

  it('invalid packages from either entry fail full parsing before asking for consent or writing', async () => {
    fake.picked = [{ name: 'bad.vetdz', data: btoa('not a zip') }];
    await clickByText('Pick import');
    await drop(strToU8('not a zip'));
    expect(document.querySelector('[data-slot="dialog-popup"]')).toBeNull();
    expect(fake.notify).toHaveBeenCalledTimes(2);
    expect(fake.create).not.toHaveBeenCalled();
    expect(fake.write).not.toHaveBeenCalled();
    expect(fake.open).not.toHaveBeenCalled();
  });
  it('rejects oversized dropped files before allocating their arrayBuffer', async () => {
    const arrayBuffer = vi.fn();
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files: [{ name: 'huge.vetdz', size: 32 * 1024 * 1024 + 1, arrayBuffer }] } });
    await act(async () => host.firstElementChild?.dispatchEvent(event));
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(fake.create).not.toHaveBeenCalled();
    expect(fake.notify).toHaveBeenCalled();
  });
  it('does not navigate after an import finishes if the user has left the gallery', async () => {
    const pending = Promise.withResolvers<{ path: string }>();
    fake.create.mockImplementationOnce(() => pending.promise);
    await drop(validBytes());
    await clickByText('gallery.action.import');
    await act(async () => root.unmount());
    // Remount a new root only so afterEach can clean it; the old action stays stale.
    root = createRoot(host);
    await act(async () => { pending.resolve({ path: '/designs/imported' }); });
    expect(fake.open).not.toHaveBeenCalled();
  });
});
