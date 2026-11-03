import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesignRegistry } from '../host/registry';
import { DesignGallery, DesignGalleryHeader } from './DesignGallery';

const fake = vi.hoisted(() => ({
  list: vi.fn(async () => ({
    archivedProjects: [{ name: 'Hidden project', path: '/projects/hidden' }],
  })),
  unarchive: vi.fn(async (_path: string) => {}),
  toast: vi.fn(),
}));
vi.mock('@/components/ui/toast', () => ({ addToast: fake.toast }));
vi.mock('../vetta/src/plugin-context', () => ({
  getPluginCtx: () => ({ official: { projects: fake } }),
}));
vi.mock('../host/translation', () => ({
  useTranslation: () => ({ locale: 'en', t: (key: string) => key }),
}));

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useDesignRegistry.setState({ contributions: [], ui: {} });
});

describe('registered gallery mount', () => {
  it('updates scoped header controls without feeding a fresh-header/render loop back to the view', async () => {
    const render = vi.fn();
    const click = vi.fn();
    function RegisteredGallery() {
      render();
      useEffect(() => {
        useDesignRegistry.setState({
          ui: {
            'header:gallery': {
              hideTitle: true,
              left: (
                <button type="button" onClick={click}>
                  Search
                </button>
              ),
              right: <button type="button">Create</button>,
            },
          },
        });
      });
      return <p>Gallery</p>;
    }
    useDesignRegistry.setState({
      contributions: [
        { kind: 'workspace-view', value: { id: 'gallery', component: RegisteredGallery } },
      ],
    });
    await act(async () =>
      root.render(
        <>
          <DesignGalleryHeader side="left" />
          <DesignGalleryHeader side="right" />
          <DesignGallery />
        </>
      )
    );
    expect(render).toHaveBeenCalledOnce();
    const buttons = host.querySelectorAll('button');
    expect([...buttons].map((button) => button.textContent)).toEqual(['Search', 'Create']);
    for (const button of buttons) expect(button.closest('[data-vetta-plugin-root]')).not.toBeNull();
    await act(async () => buttons[0]?.click());
    expect(click).toHaveBeenCalledOnce();
    await act(async () =>
      useDesignRegistry.setState({ ui: { 'header:gallery': { title: 'Updated title' } } })
    );
    expect(host.textContent).toContain('Updated title');
    expect(render).toHaveBeenCalledOnce();
  });

  it('uses registered view identity and restores hidden projects before refreshing that view', async () => {
    const mounts = vi.fn();
    function RegisteredGallery({ viewId, pluginId }: { viewId: string; pluginId: string }) {
      useEffect(() => {
        mounts();
      }, []);
      return (
        <div data-view={viewId} data-plugin={pluginId}>
          Gallery
        </div>
      );
    }
    useDesignRegistry.setState({
      contributions: [
        {
          kind: 'workspace-view',
          value: { id: 'gallery', component: RegisteredGallery },
        },
      ],
    });
    await act(async () => root.render(<DesignGallery />));
    expect(host.querySelector('[data-view="gallery"]')?.getAttribute('data-plugin')).toBe(
      'vetta-ui-design'
    );
    expect(host.querySelector('[data-view]')?.closest('[data-vetta-plugin-root]')).not.toBeNull();
    expect(fake.list).not.toHaveBeenCalled();
    const details = host.querySelector('details');
    await act(async () => {
      if (details) details.open = true;
      details?.dispatchEvent(new Event('toggle'));
    });
    expect(host.textContent).toContain('Hidden project');
    await act(async () => host.querySelector('button')?.click());
    expect(fake.unarchive).toHaveBeenCalledWith('/projects/hidden');
    expect(host.querySelector('[title="/projects/hidden"]')).toBeNull();
    expect(host.textContent).toContain('No hidden projects');
    expect(mounts).toHaveBeenCalledTimes(2);
  });
});
