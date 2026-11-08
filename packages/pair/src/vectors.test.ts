import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nacl from 'tweetnacl';
import { describe, expect, it, vi } from 'vitest';
import { openBoxedContentKey, openFrame, PairCryptoError, sealFrameWithNonce } from './crypto';
import {
  CHUNK_PAYLOAD_BYTES,
  createReassembler,
  encodeChunks,
  MAX_REASSEMBLED_BYTES,
} from './direct/chunk';
import { toBase64Url as b64, parsePairUri, fromBase64Url as unb64 } from './encoding';
import { decodeBoxedKey, encodeBoxedKey } from './handshake';
import {
  createFrameReplay,
  isReplayBootstrap,
  isReplayBootstrapResponse,
  nextReplayCounter,
} from './replay';
import { parsePairSessionSync } from './sessionSync';
import {
  decodeVoiceChunk,
  encodeVoiceChunks,
  VOICE_CHUNK_MAX_CHARS,
  VOICE_CHUNK_MAX_SAMPLES,
} from './voice';

const directory = fileURLToPath(new URL('../vectors/', import.meta.url));
const script = fileURLToPath(new URL('../../../scripts/pair-vectors.mjs', import.meta.url));
// JSON is intentionally loaded at test time: missing fixtures must fail, not skip the tests.
function load(name: string) {
  const value = JSON.parse(readFileSync(path.join(directory, `${name}.json`), 'utf8'));
  expect(value.version).toBe(1);
  return value;
}
function run(...args: string[]) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    timeout: 30_000,
  });
}
function bytes(length: number, seed: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (seed + 31 * i) & 255);
}
function digest(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}
function summary(value: Uint8Array | null) {
  return value === null ? null : { length: value.length, sha256: digest(value) };
}
function withRandom<T>(values: Uint8Array[], fn: () => T): T {
  const random = vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
    if (!array) throw new Error('expected random target');
    const next = values.shift();
    expect(array.byteLength).toBe(next?.length);
    new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(next!);
    return array;
  });
  try {
    const result = fn();
    expect(values).toHaveLength(0);
    return result;
  } finally {
    random.mockRestore();
  }
}

it('跨语言向量的提交内容与当前 TypeScript 协议实现逐字节一致', () => {
  const { status, stdout, stderr, error } = run('--check');
  expect(status, `${stdout}${stderr}${error ?? ''}`).toBe(0);
});

it('检查模式对缺失、字节漂移和多余 JSON 均失败且不写入，默认模式可确定性重建', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'enso-pair-vectors-'));
  try {
    expect(run('--check', '--out-dir', temp).status).toBe(1);
    expect(readdirSync(temp)).toEqual([]);
    cpSync(directory, temp, { recursive: true });
    expect(run('--check', '--out-dir', temp).status).toBe(0);
    const target = path.join(temp, 'primitives.json');
    appendFileSync(target, '\n');
    const changed = readFileSync(target);
    expect(run('--check', '--out-dir', temp).status).toBe(1);
    expect(readFileSync(target)).toEqual(changed);
    expect(run('--out-dir', temp).status).toBe(0);
    expect(readFileSync(target)).toEqual(readFileSync(path.join(directory, 'primitives.json')));
    expect(run('--check', '--out-dir', temp).status).toBe(0);
    appendFileSync(path.join(temp, 'unexpected.json'), '{}\n');
    expect(run('--check', '--out-dir', temp).status).toBe(1);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}, 30_000);

describe('共享 primitives.json 的 Kotlin 消费契约', () => {
  it('base64url 边界、标准填充及空白兼容行为来自现有解码器', () => {
    const vectors = load('primitives');
    for (const value of vectors.base64) {
      const input = new Uint8Array(Buffer.from(value.hex, 'hex'));
      expect(b64(input)).toBe(value.encoded);
      expect(unb64(value.encoded)).toEqual(input);
      for (const accepted of value.accepted ?? []) expect(unb64(accepted)).toEqual(input);
    }
    for (const text of vectors.invalidBase64) expect(() => unb64(text)).toThrow();
  });

  it('链接支持双格式、默认和非默认端口、片段优先与重复参数的首值', () => {
    const vectors = load('primitives');
    expect(vectors.invites.length).toBeGreaterThanOrEqual(10);
    for (const value of vectors.invites) {
      const parsed = parsePairUri(value.uri);
      expect(parsed.relay).toBe(value.relay);
      expect(b64(parsed.publicKey)).toBe(value.publicKey);
      expect(parsed.publicKey).toHaveLength(32);
    }
    for (const uri of vectors.invalidInvites) expect(() => parsePairUri(uri)).toThrow();
  });

  it('AES-GCM 帧的 nonce、UTF-8 JSON、密文与 tag 逐字节兼容', async () => {
    for (const value of load('primitives').frames) {
      const payload = JSON.parse(value.plaintext);
      expect(JSON.stringify(payload)).toBe(value.plaintext);
      expect(unb64(value.key)).toHaveLength(32);
      expect(unb64(value.nonce)).toHaveLength(12);
      const frame = await sealFrameWithNonce(unb64(value.key), payload, unb64(value.nonce));
      expect(b64(frame)).toBe(value.frame);
      expect(frame[0]).toBe(1);
      expect(frame.subarray(1, 13)).toEqual(unb64(value.nonce));
      expect(frame.length).toBe(29 + new TextEncoder().encode(value.plaintext).length);
      expect(await openFrame(unb64(value.key), unb64(value.frame))).toEqual(payload);
    }
  });
});

it('固定 tweetnacl box 的密钥、nonce、boxedKey 线格式可逆且篡改后拒绝', () => {
  const vectors = load('crypto');
  const value = vectors.box;
  expect(b64(nacl.box.keyPair.fromSecretKey(unb64(value.hostSecretKey)).publicKey)).toBe(
    value.hostPublicKey
  );
  expect(b64(nacl.box.keyPair.fromSecretKey(unb64(value.ephSecretKey)).publicKey)).toBe(
    value.ephPublicKey
  );
  expect(
    b64(
      nacl.box(
        unb64(value.contentKey),
        unb64(value.nonce),
        unb64(value.hostPublicKey),
        unb64(value.ephSecretKey)
      )
    )
  ).toBe(value.boxed);
  const decoded = decodeBoxedKey(value.boxedKey);
  expect(encodeBoxedKey(decoded)).toBe(value.boxedKey);
  expect(decoded.boxed).toHaveLength(48);
  expect(openBoxedContentKey(decoded, unb64(value.hostSecretKey))).toEqual(unb64(value.contentKey));
  const tampered = { ...decoded, boxed: decoded.boxed.slice() };
  tampered.boxed[0] ^= 1;
  expect(() => openBoxedContentKey(tampered, unb64(value.hostSecretKey))).toThrow(PairCryptoError);
  for (const invalid of vectors.invalidBoxedKeys) expect(() => decodeBoxedKey(invalid)).toThrow();
});

it('错误 AES 版本、短帧、错误密钥、认证失败与认证后的非 JSON 都拒绝', async () => {
  for (const value of load('crypto').invalidFrames) {
    await expect(openFrame(unb64(value.key), unb64(value.frame)), value.name).rejects.toThrow(
      PairCryptoError
    );
  }
});

it('防重放入站序列保持 trusted、ready、窗口、pin 与 128 个前缀边界', async () => {
  const vectors = load('replay');
  const key = unb64(vectors.key);
  expect(vectors.sequences).toHaveLength(6);
  for (const sequence of vectors.sequences) {
    let pins = 0;
    const { local } = sequence;
    const state = withRandom([unb64(local.prefix), unb64(local.challenge)], () =>
      createFrameReplay(
        (k, payload, nonce) => sealFrameWithNonce(k, payload, nonce ?? unb64(vectors.legacyNonce)),
        openFrame,
        {
          role: local.role,
          announce: local.announce,
          requireModern: local.requireModern,
          onModern() {
            pins++;
            if (local.pinFails) throw new Error('fixture pin failure');
          },
        }
      )
    );
    const status = () => ({ ready: state.isReady(), failed: state.isFailed(), pins });
    for (const [stepIndex, step] of sequence.steps.entries()) {
      const context = `${sequence.name} step ${stepIndex} (${step.op})`;
      if (step.op === 'receive') {
        let opened: Awaited<ReturnType<typeof state.open>>;
        let error = false;
        try {
          opened = await state.open(key, unb64(step.frame));
        } catch {
          error = true;
        }
        expect(
          {
            accepted: opened !== undefined,
            trusted: opened?.trusted ?? false,
            error,
            ...(opened ? { payload: opened.payload } : {}),
            ...status(),
          },
          context
        ).toEqual(step.expected);
      } else if (step.op === 'seal') {
        if (step.expected.error)
          await expect(state.seal(key, step.payload), context).rejects.toThrow(PairCryptoError);
        else expect(b64(await state.seal(key, step.payload)), context).toBe(step.expected.frame);
        expect(status(), context).toMatchObject({
          ready: step.expected.ready,
          failed: step.expected.failed,
          pins: step.expected.pins,
        });
      } else if (step.op === 'reset') {
        withRandom([unb64(step.challenge)], () => state.peerReset());
        expect(status(), context).toEqual(step.expected);
      } else if (step.op === 'takeHello') {
        expect({ hello: state.takeHello(), ...status() }, context).toEqual(step.expected);
      } else if (step.op === 'prefixRange') {
        const inputs: Uint8Array[] = [];
        const outcomes = [];
        for (let index = step.first; index < step.first + step.count; index++) {
          const nonce = new Uint8Array(12);
          const view = new DataView(nonce.buffer);
          view.setUint32(0, 0x70656572);
          view.setUint32(4, index);
          view.setUint32(8, step.counter);
          const frame = await sealFrameWithNonce(
            key,
            {
              ...step.payload,
              replay: {
                r: local.role === 'host' ? 'g' : 'h',
                p: b64(nonce.subarray(0, 8)),
                c: step.challenge,
              },
            },
            nonce
          );
          inputs.push(frame);
          const opened = await state.open(key, frame);
          outcomes.push({
            index,
            accepted: !!opened,
            trusted: opened?.trusted ?? false,
            ...status(),
          });
        }
        expect(
          {
            accepted: outcomes.filter((v) => v.accepted).length,
            trusted: outcomes.filter((v) => v.trusted).length,
            framesSha256: digest(Buffer.concat(inputs)),
            first: outcomes[0],
            last: outcomes.at(-1),
            ...status(),
          },
          context
        ).toEqual(step.expected);
      } else throw new Error(`unknown vector operation: ${step.op}`);
    }
  }
});

it('防重放计数器耗尽与 bootstrap 白名单不漂移', () => {
  const vectors = load('replay');
  for (const value of vectors.counterCases) {
    if (value.error) expect(() => nextReplayCounter(value.value)).toThrow(PairCryptoError);
    else expect(nextReplayCounter(value.value)).toBe(value.next);
  }
  for (const value of vectors.bootstrap) {
    expect(isReplayBootstrap(value.type)).toBe(value.command);
    expect(isReplayBootstrapResponse(value.type)).toBe(value.response);
  }
});

it('session-sync 合规输入原样保留，不合规身份、键集、序列与快照拒绝', () => {
  const vectors = load('session-sync');
  expect(vectors.cases.filter((value: { accepted: boolean }) => value.accepted)).toHaveLength(6);
  for (const value of vectors.cases) {
    expect(parsePairSessionSync(value.input), value.name).toEqual(
      value.accepted ? value.input : null
    );
  }
});

it('分片逐字节摘要覆盖空帧、16KiB、1MiB 边界，不保存兆字节输入', () => {
  const vectors = load('chunks');
  expect(vectors.payloadBytes).toBe(CHUNK_PAYLOAD_BYTES);
  expect(vectors.maxBytes).toBe(MAX_REASSEMBLED_BYTES);
  for (const value of vectors.roundTrips) {
    const input = bytes(value.length, value.seed);
    const chunks = encodeChunks(input);
    expect(
      chunks.map((part) => ({
        flag: part[0],
        ...summary(part),
        ...(part.length <= 32 ? { encoded: b64(part) } : {}),
      }))
    ).toEqual(value.chunks);
    const r = createReassembler();
    let result: Uint8Array | null = null;
    for (const part of chunks) result = r.push(part) ?? result;
    expect(summary(result)).toEqual(value.result);
    if (value.result !== null) expect(Buffer.compare(result!, input)).toBe(0);
  }
});

it('重组器的非法头、超限跳过、恢复与连续帧序列一致', () => {
  for (const sequence of load('chunks').sequences) {
    const r = createReassembler();
    let pushes = 0;
    const completed = [];
    for (const step of sequence.steps) {
      let part: Uint8Array;
      if (step.encoded !== undefined) part = unb64(step.encoded);
      else {
        part = new Uint8Array(1 + step.length);
        part[0] = step.flag;
        part.set(bytes(step.length, step.seed), 1);
      }
      for (let i = 0; i < (step.repeat ?? 1); i++) {
        pushes++;
        const result = r.push(part);
        if (result !== null) completed.push({ push: pushes, ...summary(result) });
      }
    }
    expect({ pushes, completed }, sequence.name).toEqual(sequence.expected);
  }
});

it('语音 Float32 的限幅、NaN、取整、小端 PCM 与分块字节一致', () => {
  const vectors = load('voice');
  for (const value of vectors.cases) {
    const samples = Float32Array.from(value.samples, (entry: number | string) =>
      typeof entry === 'number'
        ? entry
        : entry === 'NaN'
          ? Number.NaN
          : entry === '+Infinity'
            ? Infinity
            : -Infinity
    );
    const chunks = encodeVoiceChunks(samples, value.samplesPerChunk);
    expect(chunks, value.name).toEqual(value.encoded);
    expect(
      chunks.map((text) => Array.from(decodeVoiceChunk(text)!)),
      value.name
    ).toEqual(value.pcm);
  }
  for (const encoded of vectors.invalid) expect(decodeVoiceChunk(encoded)).toBeNull();
});

it('语音满块 192000 个样本及前后边界用紧凑配方锁定', () => {
  const vectors = load('voice');
  expect(vectors.maxSamples).toBe(VOICE_CHUNK_MAX_SAMPLES);
  expect(vectors.maxChars).toBe(VOICE_CHUNK_MAX_CHARS);
  for (const value of vectors.boundaries) {
    const audio = Float32Array.from(
      { length: value.length },
      (_, i) => value.pattern[i % value.pattern.length]
    );
    const chunks = encodeVoiceChunks(audio).map((text) => {
      const pcm = decodeVoiceChunk(text)!;
      const bytes = new Uint8Array(pcm.length * 2);
      const view = new DataView(bytes.buffer);
      for (let i = 0; i < pcm.length; i++) view.setInt16(i * 2, pcm[i], true);
      return {
        chars: text.length,
        sha256: digest(text),
        samples: pcm.length,
        pcmSha256: digest(bytes),
      };
    });
    expect(chunks).toEqual(value.chunks);
    for (const result of chunks) expect(result.chars).toBeLessThanOrEqual(VOICE_CHUNK_MAX_CHARS);
  }
});
