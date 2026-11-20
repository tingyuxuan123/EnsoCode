import type { MemoryNoteSummary } from '@shared/memory/dto';
import { describe, expect, it } from 'vitest';
import { buildWikiFileTree } from './wikiTree';

function note(over: Partial<MemoryNoteSummary> = {}): MemoryNoteSummary {
  return {
    id: 'global::wiki/systems/auth.md',
    spaceId: 'global',
    spaceLabel: 'Global',
    relPath: 'wiki/systems/auth.md',
    slug: 'systems/auth',
    title: 'Auth Architecture',
    description: '',
    type: 'systems',
    status: 'verified',
    tags: [],
    isRaw: false,
    isArchived: false,
    generatedBy: 'user',
    generatedAt: '2026-11-20T00:00:00.000Z',
    verifiedBy: 'user',
    verifiedAt: '2026-11-20T00:00:00.000Z',
    staleAfter: null,
    outboundCount: 0,
    inboundCount: 0,
    lineCount: 10,
    updatedAt: '2026-11-20T00:00:00.000Z',
    ...over,
  };
}

describe('buildWikiFileTree', () => {
  const sample: MemoryNoteSummary[] = [
    note(),
    note({
      id: 'global::wiki/incidents/outage.md',
      relPath: 'wiki/incidents/outage.md',
      slug: 'incidents/outage',
      title: 'Outage Postmortem',
      type: 'incidents',
      status: 'draft',
    }),
    note({
      id: 'global::raw/prd.md',
      relPath: 'raw/prd.md',
      slug: 'raw/prd',
      title: 'Payment PRD',
      type: 'raw',
      isRaw: true,
    }),
    note({
      id: 'global::archive/old.md',
      relPath: 'archive/old.md',
      slug: 'old',
      title: 'Old Note',
      type: 'notes',
      status: 'deprecated',
      isArchived: true,
    }),
  ];

  it('builds folder hierarchy with nested directories and keeps system doc metadata separate', () => {
    const folders = buildWikiFileTree(sample, { groupMode: 'folder' });
    expect(folders.map((n) => n.label)).toEqual(['wiki', 'raw', 'archive']);
    const wikiFolder = folders[0];
    expect(wikiFolder.kind).toBe('folder');
    expect(wikiFolder.children.map((c) => c.label)).toEqual(['incidents', 'systems']);
    expect(wikiFolder.children[1].children[0]?.note?.slug).toBe('systems/auth');
  });

  it('groups active wiki notes by category in type mode with dedicated raw & archive buckets', () => {
    const groups = buildWikiFileTree(sample, { groupMode: 'type' });
    expect(groups.map((g) => g.label)).toEqual(['incidents', 'systems', 'raw', 'archive']);
    expect(groups[0].children).toHaveLength(1);
    expect(groups[0].children[0]?.note?.status).toBe('draft');
  });
});
