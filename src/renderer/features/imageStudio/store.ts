import type {
  ImageStudioOptions,
  ImageStudioSession,
  ImageStudioSummary,
} from '@shared/imageStudio';
import { create } from 'zustand';
import {
  resizeSidePanelWidth,
  SIDE_PANEL_DEFAULT_WIDTH,
  SIDE_PANEL_MIN_WIDTH,
} from '@/stores/sidePanel/width';

const HISTORY_WIDTH_KEY = 'enso-image-studio-history-width';
function readHistoryWidth(): number {
  try {
    const width = Number(localStorage.getItem(HISTORY_WIDTH_KEY));
    return Number.isFinite(width) && width >= SIDE_PANEL_MIN_WIDTH
      ? width
      : SIDE_PANEL_DEFAULT_WIDTH;
  } catch {
    return SIDE_PANEL_DEFAULT_WIDTH;
  }
}

interface StudioState {
  open: boolean;
  historyOpen: boolean;
  historyWidth: number;
  summaries: ImageStudioSummary[];
  sessions: Record<string, ImageStudioSession>;
  activeId: string | null;
  loading: boolean;
  error: string;
  pending: Record<string, boolean>;
  drafts: Record<string, string>;
  sources: Record<string, string | undefined>;
  setOpen(open: boolean): void;
  toggleHistory(): void;
  nudgeHistoryWidth(delta: number, workspaceWidth: number): void;
  setDraft(id: string, value: string): void;
  setSource(id: string, value?: string): void;
  refresh(): Promise<void>;
  select(id: string): Promise<void>;
  newSession(): Promise<string | null>;
  generate(id: string, options: ImageStudioOptions): Promise<void>;
  cancel(id: string): Promise<void>;
  importReference(id: string): Promise<void>;
  remove(id: string): Promise<void>;
}

const api = () => window.electronAPI.imageStudio;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
export const useImageStudioStore = create<StudioState>((set, get) => {
  const reads = new Map<string, number>();
  const draftRevisions = new Map<string, number>();
  const sourceRevisions = new Map<string, number>();
  const deliveries = new Map<
    string,
    {
      prompt: string;
      original: string;
      sourceImageId?: string;
      draftRevision: number;
      sourceRevision: number;
      existingTurns: Set<string>;
    }
  >();
  let revision = 0;
  let refreshToken = 0;
  const invalidate = (id: string) => reads.set(id, (reads.get(id) ?? 0) + 1);
  const accept = (session: ImageStudioSession) => {
    invalidate(session.id);
    revision++;
    const delivery = deliveries.get(session.id);
    const accepted =
      delivery &&
      session.turns.some(
        (turn) =>
          !delivery.existingTurns.has(turn.id) &&
          turn.prompt === delivery.prompt &&
          turn.sourceImageId === delivery.sourceImageId
      );
    if (accepted) deliveries.delete(session.id);
    set((state) => ({
      sessions: { ...state.sessions, [session.id]: session },
      summaries: [session, ...state.summaries.filter((item) => item.id !== session.id)].sort(
        (a, b) => b.updatedAt - a.updatedAt
      ),
      ...(accepted && delivery
        ? {
            drafts:
              (draftRevisions.get(session.id) ?? 0) === delivery.draftRevision &&
              state.drafts[session.id] === delivery.original
                ? { ...state.drafts, [session.id]: '' }
                : state.drafts,
            sources:
              (sourceRevisions.get(session.id) ?? 0) === delivery.sourceRevision &&
              state.sources[session.id] === delivery.sourceImageId
                ? { ...state.sources, [session.id]: undefined }
                : state.sources,
          }
        : {}),
    }));
  };
  const load = async (id: string) => {
    invalidate(id);
    const token = reads.get(id);
    const result = await api().read(id);
    if (reads.get(id) !== token) return;
    if (result.ok) accept(result.value);
    else set({ error: result.error });
  };
  return {
    open: false,
    historyOpen: false,
    historyWidth: readHistoryWidth(),
    summaries: [],
    sessions: {},
    activeId: null,
    loading: false,
    error: '',
    pending: {},
    drafts: {},
    sources: {},
    setOpen: (open) => set({ open }),
    toggleHistory: () => set((state) => ({ historyOpen: !state.historyOpen })),
    nudgeHistoryWidth: (delta, workspaceWidth) => {
      const width = resizeSidePanelWidth(get().historyWidth, delta, workspaceWidth);
      set({ historyWidth: width });
      try {
        localStorage.setItem(HISTORY_WIDTH_KEY, String(width));
      } catch {
        /* Device-local UI preference only. */
      }
    },
    setDraft: (id, value) => {
      draftRevisions.set(id, (draftRevisions.get(id) ?? 0) + 1);
      set((state) => ({ drafts: { ...state.drafts, [id]: value } }));
    },
    setSource: (id, value) => {
      sourceRevisions.set(id, (sourceRevisions.get(id) ?? 0) + 1);
      set((state) => ({ sources: { ...state.sources, [id]: value } }));
    },
    refresh: async () => {
      const token = ++refreshToken;
      const baseline = revision;
      set({ loading: true });
      try {
        const result = await api().list();
        if (token !== refreshToken || baseline !== revision) return;
        if (!result.ok) {
          set({ error: result.error });
          return;
        }
        set({ summaries: result.value });
        const id = get().activeId;
        if (id && result.value.some((item) => item.id === id)) await load(id);
      } catch (error) {
        set({ error: message(error) });
      } finally {
        if (token === refreshToken) set({ loading: false });
      }
    },
    select: async (id) => {
      set({ activeId: id, error: '' });
      try {
        await load(id);
      } catch (error) {
        set({ error: message(error) });
      }
    },
    newSession: async () => {
      try {
        const result = await api().create();
        if (!result.ok) {
          set({ error: result.error });
          return null;
        }
        accept(result.value);
        set({ activeId: result.value.id, error: '' });
        return result.value.id;
      } catch (error) {
        set({ error: message(error) });
        return null;
      }
    },
    generate: async (id, options) => {
      const state = get();
      const prompt = state.drafts[id]?.trim();
      if (
        !prompt ||
        !options.model ||
        state.pending[id] ||
        state.sessions[id]?.turns.some((turn) => turn.status === 'running')
      )
        return;
      if (!state.sessions[id]) {
        set({ error: '会话仍在加载，请稍后再发送。' });
        return;
      }
      const original = state.drafts[id];
      const sourceImageId = state.sources[id];
      const delivery = {
        prompt,
        original,
        sourceImageId,
        draftRevision: draftRevisions.get(id) ?? 0,
        sourceRevision: sourceRevisions.get(id) ?? 0,
        existingTurns: new Set(state.sessions[id]?.turns.map((turn) => turn.id) ?? []),
      };
      deliveries.set(id, delivery);
      set({ pending: { ...state.pending, [id]: true }, error: '' });
      try {
        const result = await api().generate({
          sessionId: id,
          prompt,
          options,
          ...(sourceImageId ? { sourceImageId } : {}),
        });
        if (!result.ok) {
          set({ error: result.error });
          return;
        }
        accept(result.value);
      } catch (error) {
        set({ error: message(error) });
      } finally {
        if (deliveries.get(id) === delivery) deliveries.delete(id);
        set((current) => {
          const pending = { ...current.pending };
          delete pending[id];
          return { pending };
        });
      }
    },
    cancel: async (id) => {
      try {
        const result = await api().cancel(id);
        if (!result.ok) set({ error: result.error });
      } catch (error) {
        set({ error: message(error) });
      }
    },
    importReference: async (id) => {
      try {
        const result = await api().importReference(id);
        if (!result.ok) {
          set({ error: result.error });
          return;
        }
        if (result.value) {
          get().setSource(id, result.value.id);
          await load(id);
        }
      } catch (error) {
        set({ error: message(error) });
      }
    },
    remove: async (id) => {
      try {
        const result = await api().remove(id);
        if (!result.ok) {
          set({ error: result.error });
          return;
        }
        invalidate(id);
        deliveries.delete(id);
        draftRevisions.delete(id);
        sourceRevisions.delete(id);
        revision++;
        set((current) => {
          const sessions = { ...current.sessions };
          delete sessions[id];
          const drafts = { ...current.drafts };
          delete drafts[id];
          const sources = { ...current.sources };
          delete sources[id];
          return {
            sessions,
            drafts,
            sources,
            summaries: current.summaries.filter((item) => item.id !== id),
            activeId: current.activeId === id ? null : current.activeId,
          };
        });
      } catch (error) {
        set({ error: message(error) });
      }
    },
  };
});
