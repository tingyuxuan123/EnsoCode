import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type HostToPhone, openFrame, type PhoneToHost, sealFrame } from '@enso/pair';
import { afterEach, describe, expect, it } from 'vitest';
import { FileTransferPort } from '../../../packages/phone/src/fileTransferPort';
import { createPairFilePort, type PairFileCommand } from './pairFiles';
import { parsePhoneCommand } from './pairPolicy';

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe('Web → 加密分块 → Main 文件服务', () => {
  it.each([
    { sessionId: 'code-session' },
    { bot: { chatId: '11111111-1111-4111-8111-111111111111', entryId: 'group-reply' } },
    {
      bot: {
        chatId: '11111111-1111-4111-8111-111111111111',
        conversationId: 'bot-session',
        messageIndex: 1,
      },
    },
  ])('Code / Bot 群聊 / 私聊经过真实加解密恢复原始二进制 %j', async (target) => {
    root = await mkdtemp(path.join(os.tmpdir(), 'enso-file-encrypted-'));
    const bytes = Buffer.from(Uint8Array.from({ length: 1_200_123 }, (_, i) => i % 251));
    await writeFile(path.join(root, '改好的报告.bin'), bytes);
    const host = createPairFilePort(async () => ({
      root: root!,
      artifacts: [{ rel: '改好的报告.bin' }],
    }));
    const key = crypto.getRandomValues(new Uint8Array(32));
    const frames: Uint8Array[] = [];
    const requests: PhoneToHost[] = [];
    const failures: unknown[] = [];
    let phone: FileTransferPort;
    const reply = async (message: HostToPhone) => {
      const frame = await sealFrame(key, message);
      frames.push(frame);
      expect(frame.byteLength).toBeLessThan(1_000_000);
      phone.receive(
        (await openFrame(key, frame)) as Extract<
          HostToPhone,
          { type: 'file-list-result' | 'file-read-result' }
        >
      );
      return true;
    };
    phone = new FileTransferPort((message) => {
      requests.push(message);
      void (async () => {
        const encrypted = await sealFrame(key, message);
        const parsed = parsePhoneCommand(await openFrame(key, encrypted));
        expect(parsed.ok).toBe(true);
        if (parsed.ok) await host.handle(parsed.command as PairFileCommand, reply);
      })().catch((error) => {
        failures.push(error);
        phone.reset();
      });
    });
    const listed = await phone.list(target);
    expect(failures).toEqual([]);
    expect(listed).toHaveProperty('files');
    if (!('files' in listed)) throw new Error(listed.error);
    const result = await phone.download(target, listed.files[0]);
    expect(failures).toEqual([]);
    expect(result).toHaveProperty('blob');
    if (!('blob' in result)) throw new Error(result.error);
    const actual = Buffer.from(await result.blob.arrayBuffer());
    expect(actual.equals(bytes)).toBe(true);
    expect(createHash('sha256').update(actual).digest('hex')).toBe(
      '2f0022d7a5f17225917c16c2cda528c3dced459a8aa1be5b739a7a805ddbbce5'
    );
    expect(requests.filter((request) => request.type === 'file-read')).toHaveLength(4);
    expect(Math.max(...frames.map((frame) => frame.byteLength))).toBeLessThan(525_000);
    expect(requests.every((request) => !('rel' in request) && !('path' in request))).toBe(true);
    phone.reset();
  });
});
