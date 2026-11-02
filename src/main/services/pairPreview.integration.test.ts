import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type HostToPhone, openFrame, type PairPreviewInput, sealFrame } from '@enso/pair';
import { afterEach, describe, expect, it } from 'vitest';
import { PreviewPort } from '../../../packages/phone/src/previewPort';
import { parsePhoneCommand } from './pairPolicy';
import { createPairPreviewPort, type PairPreviewCommand } from './pairPreview';

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe('网页预览端到端加密协议', () => {
  it('Web 列表、打开、点击、画面和关闭经过真实加解密，单帧始终小于中继上限', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'enso-preview-e2e-'));
    await writeFile(path.join(root, 'index.html'), '<h1>preview</h1>');
    const key = crypto.getRandomValues(new Uint8Array(32));
    const actions: PairPreviewInput[] = [];
    let closed = 0;
    let time = 0;
    const manager = createPairPreviewPort({
      lookup: async () => ({ root: root!, stamp: 'authority1', messages: [] }),
      accessKey: () => 'authority1',
      now: () => time,
      browser: async () => ({
        capture: async () => ({
          width: 800,
          height: 600,
          dataUrl: `data:image/jpeg;base64,${Buffer.alloc(400_000, 3).toString('base64')}`,
          title: 'test',
        }),
        input: async (input) => {
          actions.push(input);
        },
        refresh: async () => {},
        close: () => {
          closed++;
        },
      }),
    });
    const failures: unknown[] = [];
    const frameSizes: number[] = [];
    let phone: PreviewPort;
    phone = new PreviewPort((command) => {
      setImmediate(() => {
        void (async () => {
          time += 1000;
          const request = parsePhoneCommand(await openFrame(key, await sealFrame(key, command)));
          expect(request.ok).toBe(true);
          if (!request.ok) return;
          await manager.handle('pair1', request.command as PairPreviewCommand, async (message) => {
            const frame = await sealFrame(key, message);
            frameSizes.push(frame.byteLength);
            phone.receive(
              (await openFrame(key, frame)) as Extract<
                HostToPhone,
                { type: 'preview-result' | 'preview-list-result' }
              >
            );
            return true;
          });
        })().catch((error) => {
          failures.push(error);
          phone.reset();
        });
      });
    });
    try {
      const listed = await phone.list({ sessionId: 's' });
      expect(listed).toHaveProperty('entries');
      if (!('entries' in listed)) throw new Error(listed.error);
      const opened = await phone.open({ sessionId: 's' }, listed.entries[0].id, {
        width: 800,
        height: 600,
      });
      expect(opened).toHaveProperty('frame');
      if (!('previewId' in opened) || !opened.frame) throw new Error('missing preview');
      const clicked = await phone.input(opened.previewId, opened.frame.frameId, {
        kind: 'click',
        x: 100,
        y: 200,
      });
      expect(clicked).toHaveProperty('frame');
      expect(actions).toEqual([{ kind: 'click', x: 100, y: 200 }]);
      expect(
        await phone.input(opened.previewId, opened.frame.frameId, {
          kind: 'text',
          text: 'old frame',
        })
      ).toEqual({ error: 'stale-frame' });
      expect(await phone.close(opened.previewId)).toEqual({ previewId: opened.previewId });
      expect(closed).toBe(1);
      expect(frameSizes.length).toBeGreaterThan(3);
      expect(Math.max(...frameSizes)).toBeLessThan(701_000);
      expect(failures).toEqual([]);
    } finally {
      phone.reset();
      manager.release('pair1');
    }
  });
});
