import { describe, expect, it } from 'vitest';
import { browserPresentation, recordBrowserRefs } from './browserPresentation';

describe('browser step presentation', () => {
  it('prefers a short user-facing description, never raw JSON, ref IDs or typed secrets', () => {
    expect(
      browserPresentation(
        'browser_read',
        { description: '核对登录状态', kind: 'text', scope: 'viewport' },
        '{}',
        'ok'
      )?.label
    ).toEqual({ text: '核对登录状态' });
    const fill = browserPresentation(
      'browser_fill',
      { ref: 'e1', value: 'secret-pass', description: '填写密码 secret-pass' },
      '{}',
      'ok'
    );
    expect(JSON.stringify(fill)).not.toContain('secret-pass');
    expect(JSON.stringify(fill)).not.toContain('e1');
    expect(
      browserPresentation(
        'browser_read',
        {},
        '{"tabId":"tab-x","snapshotId":"internal","text":"private page"}',
        'ok'
      )?.label
    ).toEqual({ key: 'Read page content' });
  });

  it('does not echo nested batch passwords through a model-written overall description', () => {
    const view = browserPresentation(
      'browser_act',
      {
        description: '登录 secret-pass',
        steps: [{ action: 'fill', target: '密码', text: 'secret-pass' }],
      },
      '{"completed":1}',
      'ok'
    );
    expect(JSON.stringify(view)).not.toContain('secret-pass');
  });

  it('uses previously observed control names without exposing values', () => {
    const refs = new Map<string, string>();
    recordBrowserRefs(
      refs,
      JSON.stringify({
        observation:
          'Appeared: - textbox "账号" [ref=e1] [kind=fill]\nAppeared: - textbox "密码" [ref=e2] [kind=fill]',
      })
    );
    expect(
      browserPresentation('browser_fill', { ref: 'e2', value: 'secret' }, '{}', 'ok', refs)?.label
    ).toEqual({ key: 'Fill {{target}}', target: '密码' });
    recordBrowserRefs(
      refs,
      JSON.stringify({ entries: [{ ref: 'e3', name: '同意协议', value: 'checked' }] })
    );
    expect(
      browserPresentation(
        'browser_interact',
        { action: 'set_checked', ref: 'e3', checked: true },
        '{}',
        'ok',
        refs
      )?.label
    ).toEqual({ key: 'Check {{target}}', target: '同意协议' });
  });

  it('keeps real failures and observation warnings distinct from successful actions', () => {
    expect(
      browserPresentation('browser_click', {}, 'CDP is unavailable while DevTools is open', 'error')
        ?.error
    ).toContain('DevTools');
    const warning = browserPresentation(
      'browser_click',
      {},
      JSON.stringify({
        actionCompleted: true,
        observationError: 'Page changed; read before retrying',
      }),
      'ok'
    );
    expect(warning?.warning).toContain('Page changed');
    expect(warning?.error).toBeUndefined();
  });

  it('projects each batch step, marks only confirmed completions, and does not pretend later steps ran', () => {
    const args = {
      steps: [
        { action: 'click', target: '进入登录页' },
        { action: 'fill', target: '密码', text: 'hidden' },
        { action: 'click', target: '提交登录' },
      ],
    };
    const view = browserPresentation(
      'browser_act',
      args,
      'browser_act step 2 stopped (1 completed). Target is covered',
      'error'
    );
    expect(view?.steps.map((s) => s.status)).toEqual(['completed', 'failed', 'pending']);
    expect(view?.count).toBe(2);
    expect(JSON.stringify(view)).not.toContain('hidden');
    const success = browserPresentation('browser_act', args, '{"completed":3}', 'ok');
    expect(success?.count).toBe(3);
    expect(success?.steps.every((s) => s.status === 'completed')).toBe(true);
  });

  it('uses a safe page name rather than URL credentials, query or fragment', () => {
    const view = browserPresentation(
      'browser_navigate',
      { url: 'https://account:password@example.com/login?token=secret#private' },
      '{}',
      'ok'
    );
    expect(view?.label).toEqual({ key: 'Open {{target}}', target: 'example.com/login' });
    expect(JSON.stringify(view)).not.toMatch(/password|secret|private/);
    expect(browserPresentation('read', {}, '', 'ok')).toBeUndefined();
  });
});
