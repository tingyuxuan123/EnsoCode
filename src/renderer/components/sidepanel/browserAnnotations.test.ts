import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addAnnotation,
  annotationMentionInsert,
  annotationScopeKey,
  annotationsFor,
  BROWSER_ANNOTATION_MAX,
  type BrowserAnnotationInput,
  clearAnnotations,
  pruneAnnotations,
  removeAnnotation,
  resetAnnotationsForTest,
  subscribeAnnotations,
  updateAnnotationNote,
} from './browserAnnotations';

const scope = { conversationId: 'conv-a', tabId: 'tab-1', url: 'https://example.com/pricing' };

function element(label: string, extra: Partial<BrowserAnnotationInput> = {}) {
  return {
    ...scope,
    kind: 'element' as const,
    label,
    path: `main > ${label.toLowerCase()}`,
    text: `${label} text`,
    image: { data: `img-${label}`, mimeType: 'image/png' },
    ...extra,
  };
}

beforeEach(() => resetAnnotationsForTest());

describe('browser annotation queue', () => {
  it('keeps several picks in order, each with its own note and image', () => {
    const key = annotationScopeKey(scope);
    addAnnotation(element('Save'), { id: 'a1' });
    addAnnotation(
      {
        ...scope,
        kind: 'region',
        label: 'annotation',
        path: 'scribble',
        text: '',
        image: { data: 'region-png', mimeType: 'image/png' },
      },
      { id: 'a2' }
    );
    addAnnotation(element('Cancel'), { id: 'a3' });
    updateAnnotationNote(key, 'a2', '这块留白太大');

    const queue = annotationsFor(key);
    expect(queue.map((entry) => entry.id)).toEqual(['a1', 'a2', 'a3']);
    expect(queue.map((entry) => entry.kind)).toEqual(['element', 'region', 'element']);
    expect(queue[1].note).toBe('这块留白太大');
    expect(queue[0].note).toBe('');
    expect(queue[2].image?.data).toBe('img-Cancel');
    expect(queue[0].url).toBe('https://example.com/pricing');

    removeAnnotation(key, 'a1');
    expect(annotationsFor(key).map((entry) => entry.id)).toEqual(['a2', 'a3']);
    clearAnnotations(key);
    expect(annotationsFor(key)).toEqual([]);
  });

  it('isolates queues by conversation, tab and page', () => {
    const key = annotationScopeKey(scope);
    addAnnotation(element('Save'), { id: 'a1' });

    const otherConversation = annotationScopeKey({ ...scope, conversationId: 'conv-b' });
    const otherTab = annotationScopeKey({ ...scope, tabId: 'tab-2' });
    const otherPage = annotationScopeKey({ ...scope, url: 'https://example.com/checkout' });
    for (const key of [otherConversation, otherTab, otherPage])
      expect(annotationsFor(key)).toEqual([]);

    addAnnotation(element('Pay', { conversationId: 'conv-b', tabId: 'tab-2' }), { id: 'a2' });
    expect(annotationsFor(key).map((entry) => entry.label)).toEqual(['Save']);
    expect(
      annotationsFor(annotationScopeKey({ ...scope, conversationId: 'conv-b', tabId: 'tab-2' }))
    ).toHaveLength(1);
  });

  it('drops the previous page of the same tab but keeps sibling scopes', () => {
    addAnnotation(element('Save'), { id: 'a1' });
    addAnnotation(element('Pay', { url: 'https://example.com/checkout' }), { id: 'a2' });
    addAnnotation(element('Other tab', { tabId: 'tab-2' }), { id: 'a3' });
    addAnnotation(element('Other conv', { conversationId: 'conv-b' }), { id: 'a4' });

    pruneAnnotations({ ...scope, url: 'https://example.com/checkout' });

    expect(annotationsFor(annotationScopeKey(scope))).toEqual([]);
    expect(
      annotationsFor(annotationScopeKey({ ...scope, url: 'https://example.com/checkout' }))
    ).toHaveLength(1);
    expect(annotationsFor(annotationScopeKey({ ...scope, tabId: 'tab-2' }))).toHaveLength(1);
    expect(annotationsFor(annotationScopeKey({ ...scope, conversationId: 'conv-b' }))).toHaveLength(
      1
    );
  });

  it('notifies subscribers and caps a runaway queue', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAnnotations(listener);
    const key = annotationScopeKey(scope);
    addAnnotation(element('Save'));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    for (let index = 0; index < BROWSER_ANNOTATION_MAX + 5; index += 1) {
      addAnnotation(element(`Node ${index}`));
    }
    expect(annotationsFor(key)).toHaveLength(BROWSER_ANNOTATION_MAX);
    expect(annotationsFor(key)[0].label).toBe('Save');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('maps a queued entry to one composer insert with position, note and screenshot', () => {
    const key = annotationScopeKey(scope);
    const created = addAnnotation(element('Save'), { id: 'a1' });
    updateAnnotationNote(key, 'a1', '  太靠左  ');
    const entry = annotationsFor(key).find((item) => item.id === created?.id);
    if (!entry) throw new Error('queued annotation missing');
    const insert = annotationMentionInsert(entry);
    expect(insert.candidate).toEqual({
      kind: 'ui-element',
      id: 'a1',
      label: 'Save',
      path: 'main > save',
      text: 'Save text',
      imageId: 'img-a1',
    });
    expect(insert.image).toEqual({ data: 'img-Save', mimeType: 'image/png' });
    expect(insert.note).toContain(scope.url);
    expect(insert.note).toContain(scope.tabId);
    expect(insert.note).toContain('太靠左');
    expect(entry.note).toBe('  太靠左  ');
    expect(entry.rect).toBeUndefined();
  });
});
