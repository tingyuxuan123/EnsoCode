import type {
  MemoryListQuery,
  MemoryListResult,
  MemoryNoteDetail,
  MemoryNoteSummary,
  PendingMemoryWriteDto,
} from '@shared/memory/dto';
import {
  createElement,
  type EffectCallback,
  type ElementType,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import { Dialog, DialogTitle } from '@/components/ui/dialog';
import {
  emptyReason,
  isPristineEmpty,
  MemoryLibrary,
  MemoryRows,
  PendingWritesSection,
} from './MemoryLibrary';

const hooks = vi.hoisted(() => ({ current: null as LibraryHarness | null }));

vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>();
  return {
    ...react,
    useState: (initial: unknown) =>
      // biome-ignore lint/correctness/useHookAtTopLevel: test harness only
      hooks.current ? hooks.current.state(initial) : react.useState(initial),
    useRef: (initial: unknown) =>
      // biome-ignore lint/correctness/useHookAtTopLevel: test harness only
      hooks.current ? hooks.current.memo(() => ({ current: initial }), []) : react.useRef(initial),
    useCallback: (callback: () => unknown, deps: unknown[]) =>
      // biome-ignore lint/correctness/useHookAtTopLevel: test harness only
      hooks.current ? hooks.current.memo(() => callback, deps) : react.useCallback(callback, deps),
    useEffect: (effect: EffectCallback, deps: unknown[]) =>
      // biome-ignore lint/correctness/useHookAtTopLevel: test harness only
      hooks.current ? hooks.current.effect(effect, deps) : react.useEffect(effect, deps),
  };
});

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params ? key.replace(/\{\{(\w+)\}\}/g, (_, k: string) => params[k] ?? '') : key,
  }),
}));

const t = (key: string, params?: Record<string, string>) =>
  params ? key.replace(/\{\{(\w+)\}\}/g, (_, k: string) => params[k] ?? '') : key;

function noteItem(over: Partial<MemoryNoteSummary> = {}): MemoryNoteSummary {
  return {
    id: 'global::wiki/decisions/okf.md',
    spaceId: 'global',
    spaceLabel: 'Global',
    relPath: 'wiki/decisions/okf.md',
    slug: 'decisions/okf',
    title: 'Use OKF v0.2',
    description: 'Markdown with [[wikilink]] as source of truth',
    type: 'decisions',
    status: 'verified',
    tags: ['okf'],
    isRaw: false,
    isArchived: false,
    generatedBy: 'user',
    generatedAt: '2026-11-20T00:00:00.000Z',
    verifiedBy: 'user',
    verifiedAt: '2026-11-20T00:00:00.000Z',
    staleAfter: null,
    outboundCount: 2,
    inboundCount: 1,
    lineCount: 20,
    updatedAt: '2026-11-20T00:00:00.000Z',
    ...over,
  };
}

class LibraryHarness {
  private cells: { value?: unknown; deps?: unknown[]; cleanup?: () => void }[] = [];
  private cursor = 0;
  private effects: (() => void)[] = [];
  private tree: ReactNode = null;

  state(initial: unknown) {
    const index = this.cursor++;
    if (!(index in this.cells)) {
      this.cells[index] = { value: typeof initial === 'function' ? initial() : initial };
    }
    const cell = this.cells[index];
    const set = (next: unknown) => {
      cell.value =
        typeof next === 'function' ? (next as (prev: unknown) => unknown)(cell.value) : next;
    };
    return [cell.value, set] as const;
  }

  memo<T>(factory: () => T, deps: unknown[]): T {
    const index = this.cursor++;
    const cell = this.cells[index];
    if (!cell?.deps || deps.some((d, i) => !Object.is(d, cell.deps?.[i]))) {
      const value = factory();
      this.cells[index] = { value, deps };
      return value;
    }
    return cell.value as T;
  }

  effect(callback: EffectCallback, deps: unknown[]) {
    const index = this.cursor++;
    const cell = this.cells[index];
    if (!cell?.deps || deps.some((d, i) => !Object.is(d, cell.deps?.[i]))) {
      const prevCleanup = cell?.cleanup;
      this.cells[index] = { deps };
      this.effects.push(() => {
        prevCleanup?.();
        const cleanup = callback();
        this.cells[index].cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      });
    }
  }

  render() {
    this.cursor = 0;
    this.effects = [];
    this.tree = MemoryLibrary();
    for (const run of this.effects) run();
    return this.tree;
  }

  async settle() {
    for (let i = 0; i < 4; i++) {
      this.render();
      await Promise.resolve();
    }
    return this.render();
  }

  unmount() {
    for (const cell of this.cells) cell.cleanup?.();
  }
}

function findAll(root: ReactNode, match: (el: ReactElement) => boolean): ReactElement[] {
  const hits: ReactElement[] = [];
  const visit = (node: ReactNode): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!isValidElement(node)) return;
    if (match(node)) hits.push(node);
    const props = node.props as { children?: ReactNode };
    if (props.children !== undefined) visit(props.children);
  };
  visit(root);
  return hits;
}

const byType = (root: ReactNode, type: ElementType) => findAll(root, (el) => el.type === type);

afterEach(() => {
  hooks.current?.unmount();
  hooks.current = null;
});

describe('MemoryLibrary helpers', () => {
  it('computes empty state reasons cleanly', () => {
    expect(isPristineEmpty(false, false)).toBe(true);
    expect(emptyReason(false, false)).toBe('library-empty');
    expect(emptyReason(false, true)).toBe('no-match');
    expect(emptyReason(true, false)).toBe('no-match');
  });

  it('renders rows with slug, link counts, status, and description', () => {
    const html = renderToStaticMarkup(
      createElement(MemoryRows, { items: [noteItem()], onOpen: () => {}, t })
    );
    expect(html).toContain('Use OKF v0.2');
    expect(html).toContain('[[decisions/okf]]');
    expect(html).toContain('decisions');
    expect(html).toContain('Verified');
  });

  it('renders pending write approval cards', () => {
    const writes: PendingMemoryWriteDto[] = [
      {
        id: 'w1',
        kind: 'agent',
        spaceId: 'global',
        spaceLabel: 'Global',
        botId: 'b1',
        chatId: null,
        targetRelPath: 'wiki/notes/p.md',
        slug: 'notes/p',
        title: 'Shared rule',
        type: 'notes',
        description: null,
        mode: 'replace',
        section: null,
        existingBody: null,
        proposedBody: 'Always run tests',
        redacted: false,
        createdAt: '2026-11-20T00:00:00.000Z',
      },
    ];
    const html = renderToStaticMarkup(
      createElement(PendingWritesSection, { writes, onReview: () => {}, t })
    );
    expect(html).toContain('Shared rule');
    expect(html).toContain('Always run tests');
    expect(html).toContain('[[notes/p]]');
  });
});

describe('MemoryLibrary interactive flows', () => {
  it('loads notes, opens detail editor, and enforces two-step delete confirmation', async () => {
    const detailMock: MemoryNoteDetail = {
      ...noteItem({ status: 'draft' }),
      body: 'Body text',
      rawMarkdown: '---\ntype: decisions\n---\nBody text',
      resource: null,
      sources: [],
      supersededBy: null,
      links: [],
      backlinks: [],
    };
    const del = vi.fn(async () => ({ ok: true }));
    const update = vi.fn(async () => ({
      ok: true,
      note: { ...detailMock, status: 'verified' as const },
    }));

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        electronAPI: {
          memory: {
            list: vi.fn(
              async (_q: MemoryListQuery): Promise<MemoryListResult> => ({
                items: [noteItem({ status: 'draft' })],
                total: 1,
                types: ['decisions'],
              })
            ),
            stats: vi.fn(async () => ({
              totalNotes: 1,
              totalLinks: 0,
              brokenLinks: 0,
              draftCount: 1,
              verifiedCount: 0,
              staleCount: 0,
              archivedCount: 0,
              indexBytes: 1024,
              spaces: [],
            })),
            detail: vi.fn(async () => detailMock),
            update,
            delete: del,
            pendingWrites: vi.fn(async () => []),
            onChanged: () => () => {},
          },
        },
      },
    });

    hooks.current = new LibraryHarness();
    let tree = await hooks.current.settle();

    // Open note row via MemoryRows callback
    const rowsEl = byType(tree, MemoryRows)[0];
    expect(rowsEl).toBeDefined();
    const rowProps = rowsEl.props as { items: MemoryNoteSummary[]; onOpen: (id: string) => void };
    expect(rowProps.items[0]?.title).toBe('Use OKF v0.2');
    rowProps.onOpen(rowProps.items[0].id);
    tree = await hooks.current.settle();

    const dialogs = byType(tree, Dialog);
    const detailDialog = dialogs.find((d) => (d.props as { open: boolean }).open);
    expect(detailDialog).toBeDefined();
    const titleProps = byType(detailDialog, DialogTitle)[0].props as { children?: ReactNode };
    expect(titleProps.children).toBe('Use OKF v0.2');

    // Click Delete permanently → opens confirm dialog without calling delete yet
    const deleteBtn = byType(detailDialog, Button).find((b) =>
      JSON.stringify(b.props).includes('Delete permanently')
    );
    expect(deleteBtn).toBeDefined();
    (deleteBtn!.props as { onClick: () => void }).onClick();
    tree = await hooks.current.settle();
    expect(del).not.toHaveBeenCalled();

    const confirmDialog = byType(tree, Dialog).find(
      (d) =>
        (d.props as { open: boolean }).open &&
        JSON.stringify(d.props).includes('Delete this note permanently?')
    );
    expect(confirmDialog).toBeDefined();
    const confirmBtn = byType(confirmDialog, Button).find(
      (b) => (b.props as { variant?: string }).variant === 'destructive'
    );
    (confirmBtn!.props as { onClick: () => void }).onClick();
    await hooks.current.settle();
    expect(del).toHaveBeenCalledWith('global::wiki/decisions/okf.md');
  });
});
