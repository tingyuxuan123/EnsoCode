import { describe, expect, it } from 'vitest';
import { parsePhoneCommand } from './pairPolicy';

describe('session-image 命令校验', () => {
  it('只接受会话 id + 工作区相对路径，按字段重建', () => {
    expect(
      parsePhoneCommand({
        type: 'session-image',
        requestId: 'r1',
        sessionId: 's1',
        rel: './shots/a.png',
        extra: 1,
      })
    ).toEqual({ ok: false, error: 'invalid image request' });

    expect(
      parsePhoneCommand({ type: 'session-image', requestId: 'r1', sessionId: 's1', rel: './a.png' })
    ).toEqual({
      ok: true,
      command: { type: 'session-image', requestId: 'r1', sessionId: 's1', rel: 'a.png' },
    });
  });

  it('目录外图片接受时间线里的 read 工具调用 id，按字段重建', () => {
    expect(
      parsePhoneCommand({
        type: 'session-image',
        requestId: 'r1',
        sessionId: 's1',
        toolCallId: 'call-read-1',
      })
    ).toEqual({
      ok: true,
      command: {
        type: 'session-image',
        requestId: 'r1',
        sessionId: 's1',
        toolCallId: 'call-read-1',
      },
    });
    expect(
      parsePhoneCommand({
        type: 'session-image',
        requestId: 'r1',
        sessionId: 's1',
        rel: 'a.png',
        toolCallId: 'call-read-1',
      })
    ).toMatchObject({ ok: false });
    expect(
      parsePhoneCommand({
        type: 'session-image',
        requestId: 'r1',
        sessionId: 's1',
        toolCallId: 'call\u0000read',
      })
    ).toMatchObject({ ok: false });
  });

  it('绝对路径、盘符、UNC、.. 与反斜杠都在白名单处被拒（不会进 Main 读盘）', () => {
    for (const rel of [
      '/etc/passwd',
      'C:/Windows/x.png',
      '//server/share/a.png',
      'a/../../b.png',
      'a\\b.png',
    ]) {
      const parsed = parsePhoneCommand({
        type: 'session-image',
        requestId: 'r1',
        sessionId: 's1',
        rel,
      });
      expect(parsed).toEqual({ ok: false, error: 'invalid image path' });
    }
  });

  it('缺字段或超长标识被拒', () => {
    expect(
      parsePhoneCommand({ type: 'session-image', sessionId: 's1', rel: 'a.png' })
    ).toMatchObject({
      ok: false,
    });
    expect(
      parsePhoneCommand({
        type: 'session-image',
        requestId: 'r'.repeat(101),
        sessionId: 's1',
        rel: 'a.png',
      })
    ).toMatchObject({ ok: false });
    expect(
      parsePhoneCommand({
        type: 'session-image',
        requestId: 'r1',
        sessionId: 's'.repeat(201),
        rel: 'a.png',
      })
    ).toMatchObject({ ok: false });
    expect(
      parsePhoneCommand({ type: 'session-image', requestId: 'r1', sessionId: 's1' })
    ).toMatchObject({
      ok: false,
    });
  });
});
