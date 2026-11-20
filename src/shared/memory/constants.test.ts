import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INDEX_FILENAME,
  DEFAULT_MEMORY_DISTILL_ENABLED,
  DEFAULT_MEMORY_LANGUAGE,
  DEFAULT_NOTE_STATUS,
  DEFAULT_NOTE_TYPE,
  FALLBACK_INDEX_FILENAME,
  isMemoryLanguage,
  isNoteStatus,
  isUpsertMode,
  isVaultPreset,
  LOG_FILENAME,
  MANAGED_INDEX_MARKER,
  MEMORY_LANGUAGES,
  NOTE_STATUSES,
  resolveMemoryLanguage,
  SCHEMA_FILENAME,
  UPSERT_MODES,
  VAULT_PRESETS,
} from './constants';

describe('wiki memory constants', () => {
  it('defines canonical file markers and enums', () => {
    expect(NOTE_STATUSES).toEqual(['draft', 'verified', 'deprecated']);
    expect(DEFAULT_NOTE_STATUS).toBe('draft');
    expect(DEFAULT_NOTE_TYPE).toBe('note');
    expect(DEFAULT_MEMORY_DISTILL_ENABLED).toBe(true);
    expect(DEFAULT_MEMORY_LANGUAGE).toBe('zh');
    expect(VAULT_PRESETS).toEqual(['engineering', 'personal', 'minimal']);
    expect(UPSERT_MODES).toEqual(['replace', 'append', 'section']);
    expect(MEMORY_LANGUAGES).toEqual(['en', 'zh', 'auto']);
    expect(MANAGED_INDEX_MARKER).toBe('<!-- collabra:managed -->');
    expect(DEFAULT_INDEX_FILENAME).toBe('index.md');
    expect(FALLBACK_INDEX_FILENAME).toBe('_collabra-index.md');
    expect(LOG_FILENAME).toBe('log.md');
    expect(SCHEMA_FILENAME).toBe('schema.md');
  });

  it('guards closed enums strictly', () => {
    expect(isNoteStatus('draft')).toBe(true);
    expect(isNoteStatus('verified')).toBe(true);
    expect(isNoteStatus('deprecated')).toBe(true);
    expect(isNoteStatus('active')).toBe(false);
    expect(isNoteStatus(null)).toBe(false);

    expect(isVaultPreset('engineering')).toBe(true);
    expect(isVaultPreset('personal')).toBe(true);
    expect(isVaultPreset('minimal')).toBe(true);
    expect(isVaultPreset('custom')).toBe(false);

    expect(isUpsertMode('replace')).toBe(true);
    expect(isUpsertMode('append')).toBe(true);
    expect(isUpsertMode('section')).toBe(true);
    expect(isUpsertMode('merge')).toBe(false);

    expect(isMemoryLanguage('zh')).toBe(true);
    expect(isMemoryLanguage('fr')).toBe(false);

    expect(resolveMemoryLanguage('en')).toBe('en');
    expect(resolveMemoryLanguage('auto')).toBe('auto');
    expect(resolveMemoryLanguage('zh')).toBe('zh');
    expect(resolveMemoryLanguage(undefined)).toBe('zh');
    expect(resolveMemoryLanguage('fr')).toBe('zh');
  });
});
