import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { Writer } from './protobuf';
import { frame, streamText, toolMarker } from './protocol';

const textFrame = (text: string, flags = 0) => frame(new Writer().string(2, text).build(), flags);
const trailerFrame = (value: unknown, flags = 2) =>
  frame(Buffer.from(JSON.stringify(value)), flags);

describe('Devin 流式帧解析', () => {
  it('拼接文本帧并在合法 trailer 后去掉 EOS', () => {
    const body = Buffer.concat([
      textFrame('hello '),
      frame(gzipSync(new Writer().string(2, 'world</s>').build()), 1),
      trailerFrame({}),
    ]);
    expect(streamText(body)).toBe('hello world');
  });

  it('拒绝残帧', () => {
    expect(() => streamText(textFrame('hello').subarray(0, 4))).toThrow(/frame/i);
  });

  it('拒绝长度超出缓冲区的帧', () => {
    const bad = textFrame('hello');
    bad.writeUInt32BE(999, 1);
    expect(() => streamText(bad)).toThrow(/frame/i);
  });

  it('拒绝损坏的 gzip 帧', () => {
    expect(() => streamText(frame(Buffer.from('not gzip'), 1))).toThrow(/gzip/i);
  });

  it('拒绝超出解压上限的 gzip 帧', () => {
    const bomb = frame(gzipSync(Buffer.alloc(4096)), 1);
    expect(() => streamText(bomb, 1024)).toThrow(/gzip|budget/i);
  });

  it('缺少结束 trailer 时拒绝', () => {
    expect(() => streamText(textFrame('hello'))).toThrow(/trailer/i);
  });

  it('trailer 携带错误时拒绝', () => {
    const body = Buffer.concat([textFrame('hello'), trailerFrame({ error: 'boom' })]);
    expect(() => streamText(body)).toThrow(/error/i);
  });

  it('trailer 内容不是 JSON 对象时拒绝', () => {
    const body = Buffer.concat([textFrame('hello'), frame(Buffer.from('null'), 2)]);
    expect(() => streamText(body)).toThrow(/trailer/i);
  });
});

describe('Devin 工具标记', () => {
  it('解析受限命令', () => {
    expect(toolMarker('[TOOL_CALLS] restricted_exec{"command1":{"op":"ls"}}')).toEqual({
      name: 'restricted_exec',
      args: { command1: { op: 'ls' } },
    });
  });

  it('解析旧式 [ARGS] 标记', () => {
    expect(toolMarker('[TOOL_CALLS] ANSWER[ARGS]{"files":[]}')).toEqual({
      name: 'ANSWER',
      args: { files: [] },
    });
  });

  it('JSON 后带有说明文字或 EOS 时只取第一个完整对象', () => {
    expect(toolMarker('[TOOL_CALLS] ANSWER{"files":[]} Done, no more commands.</s>')).toEqual({
      name: 'ANSWER',
      args: { files: [] },
    });
  });

  it('一次返回多个调用时只取第一个，字符串里的花括号不影响边界', () => {
    const text =
      '[TOOL_CALLS] restricted_exec{"command1":{"op":"rg","pattern":"a{b}\\"c"}}[TOOL_CALLS] restricted_exec{"command1":{"op":"ls"}}';
    expect(toolMarker(text)).toEqual({
      name: 'restricted_exec',
      args: { command1: { op: 'rg', pattern: 'a{b}"c' } },
    });
  });

  it('对象未闭合时仍按协议错误拒绝', () => {
    expect(() => toolMarker('[TOOL_CALLS] ANSWER{"files":[')).toThrow(/arguments|JSON/i);
  });

  it('无法识别的标记直接拒绝', () => {
    expect(() => toolMarker('[TOOL_CALLS] not a call')).toThrow(/tool marker/i);
  });
});
