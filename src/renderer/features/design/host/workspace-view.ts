import { isBotModeActive } from '@/stores/bots/mode';
import { useRemoteNodesStore } from '@/stores/remoteNodes';
import { useSettingsStore } from '@/stores/settings';
import { GALLERY_VIEW_ID } from '../vetta/src/tab-ids';
import { updateDesignUi, useDesignRegistry } from './registry';

export function isDesignGalleryAvailable({
  designEnabled,
  remoteNodeActive,
  botModeActive,
}: {
  designEnabled: boolean;
  remoteNodeActive: boolean;
  botModeActive: boolean;
}): boolean {
  return designEnabled && !remoteNodeActive && !botModeActive;
}

/** The registry is the only workspace route source; this state is never persisted. */
export function openDesignGallery(): void {
  if (
    !isDesignGalleryAvailable({
      designEnabled: useSettingsStore.getState().designEnabled,
      remoteNodeActive: useRemoteNodesStore.getState().activeNodeId !== 'local',
      botModeActive: isBotModeActive(),
    })
  )
    return;
  updateDesignUi('workspaceView', GALLERY_VIEW_ID);
}

export function closeDesignGallery(): void {
  if (useDesignRegistry.getState().ui.workspaceView === GALLERY_VIEW_ID)
    updateDesignUi('workspaceView', null);
}

/** Same-id row clicks are navigation too, unlike the row's pin/archive/edit controls. */
export function isDesignSessionSelection(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const row = target.closest('[data-slot="conversation-row"]');
  return !!row && !target.closest('button, a, input, textarea, select, [contenteditable="true"]');
}
