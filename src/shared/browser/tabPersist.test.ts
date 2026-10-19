import { describe, expect, it } from 'vitest';
import {
  dropPersistedTabsForSession,
  parsePersistedBrowserTabs,
  serializePersistedBrowserTabs,
} from './tabPersist';

describe('parsePersistedBrowserTabs', () => {
  it('keeps http(s) entries and drops junk', () => {
    const parsed = parsePersistedBrowserTabs({
      'conv-1': { url: 'https://example.com/', title: 'Example Domain' },
      'conv-2': { url: 'http://127.0.0.1:8877/', title: '' },
      bad: { url: 'file:///etc/passwd', title: 'x' },
      also: { url: 'https://ok.com' },
      nope: null,
    });
    expect(parsed).toEqual({
      'conv-1': {
        url: 'https://example.com/',
        title: 'Example Domain',
        conversationId: 'conv-1',
      },
      'conv-2': { url: 'http://127.0.0.1:8877/', title: '', conversationId: 'conv-2' },
      also: { url: 'https://ok.com', title: '', conversationId: 'also' },
    });
  });

  it('设备配置随标签恢复，损坏设备配置不丢掉有效 URL', () => {
    const parsed = parsePersistedBrowserTabs({
      a: { url: 'https://a.test/', device: { enabled: true, profileId: 'iphone-14-pro' } },
      b: { url: 'https://b.test/', device: { enabled: true, width: -1 } },
    });
    expect(parsed.a.device).toMatchObject({ enabled: true, width: 393, height: 852 });
    expect(parsed.b).toMatchObject({ url: 'https://b.test/' });
    expect(parsed.b.device).toBeUndefined();
  });

  it('roundtrips', () => {
    const data = { a: { url: 'https://a.test/', title: 'A', conversationId: 'conv-a' } };
    expect(parsePersistedBrowserTabs(JSON.parse(serializePersistedBrowserTabs(data)))).toEqual(
      data
    );
  });
});

describe('dropPersistedTabsForSession', () => {
  it('drops live and hibernated tabs for one session and keeps others', () => {
    expect(
      dropPersistedTabsForSession(
        {
          'browser:1': {
            url: 'https://a.test/',
            title: 'A',
            conversationId: 'conv-a',
          },
          'browser:2': {
            url: 'https://b.test/',
            title: 'B',
            conversationId: 'conv-b',
          },
          'conv-a': { url: 'https://legacy.test/', title: 'Legacy', conversationId: 'conv-a' },
        },
        'conv-a'
      )
    ).toEqual({
      'browser:2': { url: 'https://b.test/', title: 'B', conversationId: 'conv-b' },
    });
  });
});
