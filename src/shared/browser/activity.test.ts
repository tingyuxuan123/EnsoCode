import { describe, expect, it } from 'vitest';
import { BrowserActivity } from './activity';

describe('browser action network settling', () => {
  it('waits for new finite requests, not old requests or persistent streams', () => {
    const activity = new BrowserActivity();
    activity.observe('Network.requestWillBeSent', { requestId: 'old', type: 'Fetch' }, 10);
    activity.observe('Network.requestWillBeSent', { requestId: 'fetch', type: 'Fetch' }, 20);
    activity.observe('Network.requestWillBeSent', { requestId: 'ws', type: 'WebSocket' }, 20);
    activity.observe('Network.requestWillBeSent', { requestId: 'sse', type: 'EventSource' }, 20);
    expect(activity.pendingSince(20, 30)).toBe(1);
    activity.observe('Network.loadingFinished', { requestId: 'fetch' }, 30);
    expect(activity.pendingSince(20, 30)).toBe(0);
    activity.observe('Network.loadingFailed', { requestId: 'old' }, 30);
    expect(activity.pendingSince(0, 30)).toBe(0);
  });
  it('bounds dirty traffic and expires abandoned request records', () => {
    const activity = new BrowserActivity();
    for (let i = 0; i < 5000; i++)
      activity.observe('Network.requestWillBeSent', { requestId: String(i), type: 'Fetch' }, 1);
    expect(activity.pendingSince(0, 2)).toBeLessThanOrEqual(1000);
    expect(activity.pendingSince(0, 60001)).toBe(0);
    activity.observe('Network.requestWillBeSent', null, 1);
    activity.clear();
    expect(activity.pendingSince(0, 2)).toBe(0);
  });
});
