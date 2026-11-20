import { create } from 'zustand';
import { resizeSidePanelWidth, SIDE_PANEL_MIN_WIDTH } from '@/stores/sidePanel/width';

const INSPECTOR_WIDTH_KEY = 'enso-wiki-inspector-width';
const DEFAULT_INSPECTOR_WIDTH = 280;

function readInspectorWidth(): number {
  if (typeof localStorage === 'undefined') return DEFAULT_INSPECTOR_WIDTH;
  const saved = Number(localStorage.getItem(INSPECTOR_WIDTH_KEY));
  return Number.isFinite(saved) && saved >= SIDE_PANEL_MIN_WIDTH ? saved : DEFAULT_INSPECTOR_WIDTH;
}

export interface WikiWorkspaceState {
  open: boolean;
  inspectorOpen: boolean;
  inspectorWidth: number;
  unseenUpdate: boolean;
  selectedSpaceId: string | null;
  requestedNoteId: string | null;
  setOpen: (open: boolean) => void;
  toggleInspector: () => void;
  resizeInspector: (deltaX: number, workspaceWidth: number) => void;
  markUpdated: () => void;
  clearUpdated: () => void;
  setSelectedSpaceId: (spaceId: string | null) => void;
  openNote: (noteId: string) => void;
  consumeRequestedNote: () => void;
}

export const useWikiWorkspaceStore = create<WikiWorkspaceState>((set, get) => ({
  open: false,
  inspectorOpen: true,
  inspectorWidth: readInspectorWidth(),
  unseenUpdate: false,
  selectedSpaceId: null,
  requestedNoteId: null,

  setOpen: (open) => set({ open, ...(open ? { unseenUpdate: false } : {}) }),
  toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
  resizeInspector: (deltaX, workspaceWidth) => {
    const next = resizeSidePanelWidth(get().inspectorWidth, deltaX, workspaceWidth);
    if (next === get().inspectorWidth) return;
    if (typeof localStorage !== 'undefined')
      localStorage.setItem(INSPECTOR_WIDTH_KEY, String(next));
    set({ inspectorWidth: next });
  },
  markUpdated: () => {
    if (!get().open) set({ unseenUpdate: true });
  },
  clearUpdated: () => set({ unseenUpdate: false }),
  setSelectedSpaceId: (selectedSpaceId) => set({ selectedSpaceId }),
  openNote: (noteId) => set({ open: true, unseenUpdate: false, requestedNoteId: noteId }),
  consumeRequestedNote: () => set({ requestedNoteId: null }),
}));
