import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDesignRegistry } from './registry';
import {
  closeDesignGallery,
  isDesignGalleryAvailable,
  isDesignSessionSelection,
  openDesignGallery,
} from './workspace-view';

const availability = vi.hoisted(() => ({
  designEnabled: true,
  activeNodeId: 'local',
  botModeActive: false,
}));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: { getState: () => availability },
}));
vi.mock('@/stores/remoteNodes', () => ({
  useRemoteNodesStore: { getState: () => availability },
}));
vi.mock('@/stores/bots/mode', () => ({ isBotModeActive: () => availability.botModeActive }));

beforeEach(() => {
  Object.assign(availability, { designEnabled: true, activeNodeId: 'local', botModeActive: false });
  useDesignRegistry.setState({ ui: {} });
});

describe('design workspace routing', () => {
  it('opens and closes the registered gallery in the registry, preserving unrelated UI', () => {
    useDesignRegistry.setState({ ui: { panelWidth: 'max' } });
    openDesignGallery();
    expect(useDesignRegistry.getState().ui).toEqual({
      workspaceView: 'gallery',
      panelWidth: 'max',
    });
    closeDesignGallery();
    expect(useDesignRegistry.getState().ui).toEqual({ workspaceView: null, panelWidth: 'max' });
  });

  it.each([
    { designEnabled: false, activeNodeId: 'local', botModeActive: false },
    { designEnabled: true, activeNodeId: 'remote', botModeActive: false },
    { designEnabled: true, activeNodeId: 'local', botModeActive: true },
  ])('cannot open in an unavailable mode: %o', (mode) => {
    Object.assign(availability, mode);
    expect(
      isDesignGalleryAvailable({ ...mode, remoteNodeActive: mode.activeNodeId !== 'local' })
    ).toBe(false);
    openDesignGallery();
    expect(useDesignRegistry.getState().ui.workspaceView).not.toBe('gallery');
  });

  it('does not close a different workspace view', () => {
    useDesignRegistry.setState({ ui: { workspaceView: 'other' } });
    closeDesignGallery();
    expect(useDesignRegistry.getState().ui.workspaceView).toBe('other');
  });

  it('clicking the already selected session exits gallery without preventing its selection', () => {
    const sidebar = document.createElement('div');
    sidebar.innerHTML =
      '<div data-slot="conversation-row"><span>Current session</span><button>Pin</button></div>';
    openDesignGallery();
    const selectSession = vi.fn();
    sidebar.addEventListener(
      'click',
      (event) => {
        if (isDesignSessionSelection(event.target)) closeDesignGallery();
      },
      true
    );
    sidebar.firstElementChild?.addEventListener('click', selectSession);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    sidebar.querySelector('span')?.dispatchEvent(event);
    expect(useDesignRegistry.getState().ui.workspaceView).toBeNull();
    expect(selectSession).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);

    openDesignGallery();
    sidebar.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(useDesignRegistry.getState().ui.workspaceView).toBe('gallery');
    expect(isDesignSessionSelection(sidebar)).toBe(false);
    expect(isDesignSessionSelection(null)).toBe(false);
  });
});
