import { expect, it, vi } from 'vitest';
import { registerDraftTarget } from '@/plugins/draftBridge';
import {
  buildPluginAuthoringPrompt,
  fillPluginAuthoringDraft,
  readEmptyAuthoringDraft,
} from './pluginAuthoringDraft';

it('keeps existing drafts and does not replace a draft edited while the starter was being created', () => {
  let content = 'my unfinished work';
  const setText = vi.fn();
  const unregister = registerDraftTarget({
    key: 'session',
    segments: () => (content ? [{ type: 'text', text: content }] : []),
    setText,
    insertText: vi.fn(),
    busy: () => false,
  });
  try {
    expect(readEmptyAuthoringDraft('session')).toBeNull();
    content = '';
    const blank = readEmptyAuthoringDraft('session');
    expect(blank).not.toBeNull();
    content = 'typed during create';
    expect(fillPluginAuthoringDraft('session', blank, 'request')).toBe(false);
    expect(setText).not.toHaveBeenCalled();
    content = '';
    expect(fillPluginAuthoringDraft('other', readEmptyAuthoringDraft('session'), 'request')).toBe(
      false
    );
    expect(fillPluginAuthoringDraft('session', readEmptyAuthoringDraft('session'), 'request')).toBe(
      true
    );
    expect(setText).toHaveBeenCalledExactlyOnceWith('request');
  } finally {
    unregister();
  }
});

it('includes the bound relative directory, kept plugin ID, and the user’s request in the manual draft', () => {
  const draft = { id: 'local.draft123', directory: 'plugin-123' };
  const prompt = buildPluginAuthoringPrompt(draft, '  A local note panel  ', 'en');
  for (const text of [draft.id, draft.directory, 'A local note panel', 'Do not install'])
    expect(prompt).toContain(text);
});

it('binds instructions to the actual host, native theme/placement and evidence instead of claiming completion', () => {
  const prompt = buildPluginAuthoringPrompt(
    {
      id: 'local.draft123',
      directory: 'plugin-123',
      hostVersion: '0.2.110',
      template: 'workspace',
    },
    '做一个记忆插件',
    'zh'
  );
  for (const expected of [
    '0.2.110',
    'HOST-CAPABILITIES.md',
    'activitybar',
    'dataDir',
    '宿主源码',
    '尚未验证',
    'sourceHash',
  ])
    expect(prompt).toContain(expected);
});
