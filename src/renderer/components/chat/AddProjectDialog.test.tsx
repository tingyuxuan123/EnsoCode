// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddProjectDialog } from './AddProjectDialog';

vi.mock('@/i18n', () => {
  const t = (key: string) => key;
  return { useI18n: () => ({ t }) };
});
vi.mock('@/hooks/useOverlayGuard', () => ({ OverlayGuardHost: () => null }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (select: (s: object) => unknown) => select({ projects: [] }),
}));

let root: Root;
let container: HTMLDivElement;
const testSsh = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.assign(window, {
    electronAPI: {
      sshConnections: {
        list: async () => [{ id: 'ssh-1', name: 'dev', host: 'host' }],
        test: testSsh,
        listDirs: async () => ({ ok: true, path: '/remote/中文😀', dirs: [] }),
      },
      projects: { getRecent: async () => [] },
      dialog: { selectDirectory: async () => '/my/中文😀' },
    },
  });
  testSsh.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function button(text: string) {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (item) => item.textContent === text
  )!;
}
async function submit() {
  await act(async () =>
    document
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  );
}

describe('AddProjectDialog asynchronous submission', () => {
  it('keeps path on rejection, exposes field error, prevents duplicates and closes only on success', async () => {
    let finish!: (result: { ok: true } | { ok: false; error: string }) => void;
    const onAdd = vi.fn(
      () =>
        new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => {
          finish = resolve;
        })
    );
    const onOpenChange = vi.fn();
    await act(async () =>
      root.render(<AddProjectDialog open onOpenChange={onOpenChange} onAdd={onAdd} />)
    );
    await act(async () => button('Browse').click());
    await submit();
    await submit();
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    await act(async () => finish({ ok: false, error: 'Directory does not exist' }));
    const input = document.querySelector<HTMLInputElement>(
      'input[placeholder="Type a path or select from recent projects..."]'
    )!;
    expect(input.value).toBe('/my/中文😀');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Directory does not exist');
    await submit();
    await act(async () => finish({ ok: true }));
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });

  it('catches thrown local failures without closing or losing the form', async () => {
    const onOpenChange = vi.fn();
    await act(async () =>
      root.render(
        <AddProjectDialog
          open
          onOpenChange={onOpenChange}
          onAdd={async () => {
            throw new Error('Permission denied');
          }}
        />
      )
    );
    await act(async () => button('Browse').click());
    await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Permission denied');
    expect(onOpenChange).not.toHaveBeenCalled();
  });
  it('renders a readable missing-directory error instead of a filesystem operation', async () => {
    await act(async () =>
      root.render(
        <AddProjectDialog
          open
          onOpenChange={vi.fn()}
          onAdd={async () => ({
            ok: false,
            error: "ENOENT: no such file or directory, lstat '/missing'",
          })}
        />
      )
    );
    await act(async () => button('Browse').click());
    await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      'The directory does not exist or cannot be accessed.'
    );
  });

  it('keeps SSH test failures retryable and awaits the remote add result', async () => {
    const onAdd = vi.fn(async () => ({ ok: true as const }));
    const onOpenChange = vi.fn();
    await act(async () =>
      root.render(<AddProjectDialog open onOpenChange={onOpenChange} onAdd={onAdd} />)
    );
    await act(async () => button('Remote (SSH)').click());
    const connection = document.querySelector<HTMLButtonElement>('[role="combobox"]')!;
    await act(async () => connection.click());
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) =>
      item.textContent?.includes('dev (host)')
    )!;
    await act(async () => option.click());
    await act(async () => button('Browse').click());
    await act(async () => button('Use this directory').click());
    testSsh.mockRejectedValueOnce(new Error('SSH offline'));
    await submit();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('SSH offline');
    expect(
      document.querySelector<HTMLInputElement>('input[placeholder="/home/user/project"]')?.value
    ).toBe('/remote/中文😀');
    expect(onAdd).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    testSsh.mockResolvedValueOnce({ ok: true });
    await submit();
    expect(onAdd).toHaveBeenCalledWith({
      path: '/remote/中文😀',
      sshConnectionId: 'ssh-1',
      sshHost: 'dev',
    });
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
  });
});
