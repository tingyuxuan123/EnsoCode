import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { parse } from 'postcss';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

import {
  type ConversationIndicatorTone,
  ConversationStatusIndicator,
} from './ConversationStatusIndicator';

const renderTone = (
  tone: ConversationIndicatorTone,
  props?: Partial<Parameters<typeof ConversationStatusIndicator>[0]>
) => {
  const html = renderToStaticMarkup(createElement(ConversationStatusIndicator, { tone, ...props }));
  return { html, doc: parseHTML(html).document };
};

describe('ConversationStatusIndicator', () => {
  it('renders a mini Enso orbital beacon for running without svg.text-brand override risk', () => {
    const { doc, html } = renderTone('running', { size: 'sm' });
    const root = doc.querySelector('[data-slot="conversation-status"]');
    expect(root?.getAttribute('data-tone')).toBe('running');
    expect(root?.querySelector('svg')).not.toBeNull();
    expect(root?.querySelector('.codekiln-status-track')).not.toBeNull();
    expect(root?.querySelector('.codekiln-status-orbit')).not.toBeNull();
    expect(root?.querySelector('.codekiln-status-core')).not.toBeNull();
    // Mint/Cloud themes recolor svg.text-brand inside the sidebar; color must come from CSS tokens directly.
    expect(html).not.toContain('text-brand');
    expect(html).not.toContain('animate-pulse');
  });

  it('distinguishes blocking attention from failed and running with concentric pulse rings', () => {
    const { doc: attentionDoc, html: attentionHtml } = renderTone('attention', { size: 'sm' });
    const attentionRoot = attentionDoc.querySelector('[data-slot="conversation-status"]');
    expect(attentionRoot?.getAttribute('data-tone')).toBe('attention');
    expect(attentionRoot?.querySelector('.codekiln-status-attention-ring')).not.toBeNull();
    expect(attentionRoot?.querySelector('.codekiln-status-attention-core')).not.toBeNull();
    expect(attentionHtml).not.toContain('animate-pulse');

    const { doc: failedDoc } = renderTone('failed', { size: 'sm' });
    const failedRoot = failedDoc.querySelector('[data-slot="conversation-status"]');
    expect(failedRoot?.getAttribute('data-tone')).toBe('failed');
    expect(failedRoot?.querySelector('.codekiln-status-failed-ring')).not.toBeNull();
    expect(failedRoot?.querySelector('.codekiln-status-attention-ring')).toBeNull();
  });

  it('renders an accessible framed question beacon for waiting and semantic success dot for unread', () => {
    const { doc: waitingDoc } = renderTone('waiting', { size: 'sm' });
    const waitingRoot = waitingDoc.querySelector('[data-slot="conversation-status"]');
    expect(waitingRoot?.getAttribute('data-tone')).toBe('waiting');
    expect(waitingRoot?.getAttribute('role')).toBe('img');
    expect(waitingRoot?.getAttribute('aria-label')).toBe('Waiting for your answer');
    expect(waitingRoot?.querySelector('.codekiln-status-waiting-ring')).not.toBeNull();

    const { doc: unreadDoc, html: unreadHtml } = renderTone('unread', { size: 'sm' });
    const unreadRoot = unreadDoc.querySelector('[data-slot="conversation-status"]');
    expect(unreadRoot?.getAttribute('data-tone')).toBe('unread');
    expect(unreadRoot?.classList.contains('codekiln-status-unread')).toBe(true);
    expect(unreadHtml).not.toContain('bg-green-500');
  });

  it('supports both hollow ring (default) and Plan A subtle alignment dot for idle rows', () => {
    const { doc: ringDoc } = renderTone('idle', { size: 'sm' });
    const ringRoot = ringDoc.querySelector('[data-slot="conversation-status"]');
    expect(ringRoot?.getAttribute('data-tone')).toBe('idle');
    expect(ringRoot?.classList.contains('codekiln-status-idle-ring')).toBe(true);

    const { doc: subtleDoc } = renderTone('idle', {
      size: 'sm',
      idleVariant: 'subtle-dot',
      active: false,
    });
    const subtleRoot = subtleDoc.querySelector('[data-slot="conversation-status"]');
    expect(subtleRoot?.classList.contains('codekiln-status-idle-dot')).toBe(true);
    expect(subtleRoot?.getAttribute('data-active')).toBeNull();

    const { doc: activeDoc } = renderTone('idle', {
      size: 'sm',
      idleVariant: 'subtle-dot',
      active: true,
    });
    const activeRoot = activeDoc.querySelector('[data-slot="conversation-status"]');
    expect(activeRoot?.classList.contains('codekiln-status-idle-dot')).toBe(true);
    expect(activeRoot?.getAttribute('data-active')).toBe('true');
  });

  it('disables sidebar status animations under prefers-reduced-motion: reduce', () => {
    const css = parse(readFileSync(new URL('../../styles/shared.css', import.meta.url), 'utf8'));
    for (const selector of [
      '.codekiln-status-orbit',
      '.codekiln-status-core',
      '.codekiln-status-attention-ring',
      '.codekiln-status-waiting',
    ]) {
      const normal = new Map<string, string>();
      const reduced = new Map<string, string>();
      css.walkRules((rule) => {
        if (!rule.selectors.includes(selector)) return;
        const parent = rule.parent;
        const target =
          parent?.type === 'atrule' && parent.params === '(prefers-reduced-motion: reduce)'
            ? reduced
            : normal;
        rule.walkDecls((decl) => {
          target.set(decl.prop, decl.value);
        });
      });
      expect(normal.get('animation'), selector).toContain('infinite');
      expect(reduced.get('animation'), selector).toBe('none');
    }
  });
});
