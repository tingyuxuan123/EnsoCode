import { describe, expect, it } from 'vitest';
import { phoneCommandRejection } from './commandRejection';
import { appendEchoMessages, captureQueueSendEcho } from './queueSendEcho';

describe('phone 命令拒绝反馈', () => {
  it.each([
    'handshake queue full',
    'handshake timeout',
    'connection changed',
    'offline',
    'replay state exhausted',
  ])('明确显示 %s，不能伪报已送达', (error) => {
    const result = phoneCommandRejection('prompt', error);
    expect(result.notice).toContain('未发送');
    expect(result.notice).toContain(error);
  });
  it('马上发送失败恢复权威排队项，不把乐观消息伪装成已送达', () => {
    const queued = [{ id: 'm', text: 'not sent' }];
    const echo = captureQueueSendEcho(queued, 's', 'm', []);
    const rejected = phoneCommandRejection('queue-send-now', 'handshake timeout');
    const echoes = rejected.clearQueueEchoes ? [] : [echo!];
    expect(appendEchoMessages([], echoes, 's')).toEqual([]);
    expect(phoneCommandRejection('prompt', 'offline').clearQueueEchoes).toBe(false);
  });
});
