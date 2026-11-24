import { describe, expect, it } from 'vitest';
import {
  PASTED_TEXT_FILE_MIN_CHARS,
  pastedTextFileContent,
  splitPastedTextRefs,
  stripPastedTextRefs,
} from './pastedText';

const ID = '45451c80-50eb-464e-bd55-366c66d49bff';
const MAC = `/Users/me/Library/Application Support/enso-code/agent/sessions/pasted-text/${ID}/d76184b6/pasted-text.txt`;
const LEGACY = `/Users/me/Library/Application Support/enso-code/agent/sessions/pasted-text/bot-${ID}/19462dd5/pasted-text.txt`;
const WIN = `C:\\Users\\me\\AppData\\Roaming\\enso code\\agent\\sessions\\pasted-text\\${ID}\\0a1b2c3d\\pasted-text.txt`;

describe('pastedTextFileContent', () => {
  it('49,999 字符保持正文，50,000 字符转文件', () => {
    expect(PASTED_TEXT_FILE_MIN_CHARS).toBe(50_000);
    expect(pastedTextFileContent('a'.repeat(49_999))).toBeNull();
    expect(pastedTextFileContent('a'.repeat(50_000))).toBe('a'.repeat(50_000));
  });

  it('CRLF / CR 统一为 \\n 后计数', () => {
    const crlf = `${'a'.repeat(24_999)}\r\n${'b'.repeat(24_999)}`;
    expect(crlf.length).toBe(50_000);
    expect(pastedTextFileContent(crlf)).toBeNull();
    const lines = `${'a'.repeat(24_999)}\r\n${'b'.repeat(25_000)}\r${'c'}`;
    expect(pastedTextFileContent(lines)).toBe(`${'a'.repeat(24_999)}\n${'b'.repeat(25_000)}\nc`);
  });

  it('首尾空白不计入，内容按去空白后的文本保存', () => {
    const padded = `  \n\t${'a'.repeat(49_999)}\n \r\n`;
    expect(pastedTextFileContent(padded)).toBeNull();
    expect(pastedTextFileContent(`\n ${'a'.repeat(50_000)} \n`)).toBe('a'.repeat(50_000));
  });
});

describe('splitPastedTextRefs', () => {
  it('含空格的绝对路径整体识别为一个文件段，前后正文保留', () => {
    expect(splitPastedTextRefs(`@${MAC} 请总结，再看 @src/a.ts`)).toEqual([
      { type: 'file', path: MAC },
      { type: 'text', text: ' 请总结，再看 @src/a.ts' },
    ]);
    expect(splitPastedTextRefs(`对比@${LEGACY}\u00a0和\n@${WIN}`)).toEqual([
      { type: 'text', text: '对比' },
      { type: 'file', path: LEGACY },
      { type: 'text', text: '\u00a0和\n' },
      { type: 'file', path: WIN },
    ]);
  });

  it('非固定形态的路径不识别', () => {
    for (const text of [
      '@/Users/me/Application Support/pasted-text.txt',
      `@/x/pasted-text/${ID}/d76184b/pasted-text.txt`,
      `@/x/pasted-text/not-a-uuid/d76184b6/pasted-text.txt`,
      `/x/pasted-text/${ID}/d76184b6/pasted-text.txt`,
      `@relative/pasted-text/${ID}/d76184b6/pasted-text.txt`,
      `@/a\n/b/pasted-text/${ID}/d76184b6/pasted-text.txt`,
    ]) {
      expect(splitPastedTextRefs(text)).toEqual([{ type: 'text', text }]);
    }
  });

  it('stripPastedTextRefs 剥掉引用只留正文', () => {
    expect(stripPastedTextRefs(`@${MAC} 请总结这份日志`)).toBe(' 请总结这份日志');
    expect(stripPastedTextRefs(`@${MAC}\u00a0`).trim()).toBe('');
  });
});
