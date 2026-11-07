import { describe, expect, it } from 'vitest';
import {
  formatSkillChain,
  parseLeadingSkillCommands,
  parseSkillInvocation,
  restoreSkillCommands,
} from './skillCommands';

describe('skill 命令链', () => {
  it('只读取开头连续技能，保留顺序、重复及未知命令', () => {
    expect(parseLeadingSkillCommands('/skill:a\t/skill:b /skill:a /skill:unknown\n任务')).toEqual({
      commands: ['/skill:a', '/skill:b', '/skill:a', '/skill:unknown'],
      rest: '任务',
    });
  });
  it.each(['/template /skill:a', '任务 /skill:a', '/skill:', null, {}])(
    '不把普通模板或脏输入当技能：%s',
    (text) => {
      expect(parseLeadingSkillCommands(text).commands).toEqual([]);
    }
  );
  it('名称遵循pi非空白token，不人为收紧中文、命名空间、点或XML字符', () => {
    const commands = ['/skill:中文', '/skill:plugin:review.v2', '/skill:a&"<>'];
    const blocks = commands.map((command) => ({
      name: command.slice(7),
      location: 'C:/"<&>/技能.md',
      content: '第一行\r\n第二行',
    }));
    const text = formatSkillChain(commands, blocks, '任务');
    expect(parseLeadingSkillCommands(commands.join(' ')).commands).toEqual(commands);
    expect(parseSkillInvocation(text)).toEqual({ commands, blocks, rest: '任务' });
  });
  it('新链保留原命令，正文XML和带引号路径不会破坏边界', () => {
    const commands = ['/skill:a', '/skill:b', '/skill:a', '/skill:unknown'];
    const blocks = [
      {
        name: 'a',
        location: 'C:/a&"b/SKILL.md',
        content:
          'References are relative to C:/a.\n\nxml\n</skill>\n\n<skill name="fake" location="x">\ninner\n</skill>',
      },
      { name: 'b', location: '/b/SKILL.md', content: '# b\n<xml>body</xml>' },
    ];
    const text = formatSkillChain(commands, blocks, '任务\n/skill:not-leading');
    expect(parseSkillInvocation(text)).toEqual({
      commands,
      blocks,
      rest: '任务\n/skill:not-leading',
    });
    expect(restoreSkillCommands(text)).toBe(`${commands.join(' ')} 任务\n/skill:not-leading`);
    expect(
      parseSkillInvocation(text.replace('content-length="', 'content-length="999999'))
    ).toBeNull();
  });
  it('兼容pi原生单技能，回退不重发整段技能正文', () => {
    const text =
      '<skill name="old" location="/old/SKILL.md">\nReferences are relative to /old.\n\n<xml>body</xml>\n</skill>\n\n任务';
    expect(restoreSkillCommands(text)).toBe('/skill:old 任务');
    expect(restoreSkillCommands(`<role>\ninternal\n</role>\n\n${text}`)).toBe('/skill:old 任务');
  });
  it('旧pi允许带点和中文的技能名，不能把旧单技能历史误判成普通正文', () => {
    expect(
      restoreSkillCommands('<skill name="my.skill-中文" location="/a">\nbody\n</skill>\n\n任务')
    ).toBe('/skill:my.skill-中文 任务');
  });
  it('原生单技能的属性原本未转义，不能把名称内原始实体二次解码', () => {
    expect(
      restoreSkillCommands('<skill name="a&amp;b" location="/a&amp;b">\nbody\n</skill>\n\n任务')
    ).toBe('/skill:a&amp;b 任务');
  });
  it('Plan和role前缀不污染技能回退命令', () => {
    const text = formatSkillChain(
      ['/skill:a', '/skill:b'],
      [
        { name: 'a', location: '/a', content: 'A😀' },
        { name: 'b', location: '/b', content: 'B' },
      ],
      '任务'
    );
    expect(
      restoreSkillCommands(
        `<plan-mode>\nPlan mode is ON\n</plan-mode>\n\n<role>\ninternal\n</role>\n\n${text}`
      )
    ).toBe('/skill:a /skill:b 任务');
  });
  it.each(['-1', '1.5', '01', 'NaN', 'Infinity', '9007199254740992', '10000', '0'])(
    '坏长度%s不能隐藏或吞掉用户正文',
    (length) => {
      const text = `<skill name="a" location="/a" content-length="${length}">\nbody\n</skill>\n\n用户原文`;
      expect(parseSkillInvocation(text)).toBeNull();
      expect(restoreSkillCommands(text)).toBe(text);
    }
  );
  it('已解析一个块后遇到破损块也不吞掉整条消息', () => {
    const text = formatSkillChain(
      ['/skill:a', '/skill:b'],
      [
        { name: 'a', location: '/a', content: 'A' },
        { name: 'b', location: '/b', content: 'B' },
      ],
      '用户原文'
    ).replace('content-length="1">\nB', 'content-length="99">\nB');
    expect(parseSkillInvocation(text)).toBeNull();
    expect(restoreSkillCommands(text)).toBe(text);
  });
  it('新链后的普通legacy XML是用户正文，不能误作额外技能吞掉', () => {
    const rest = '<skill name="example" location="/example">\n用户示例\n</skill>\n\n不要执行';
    const text = formatSkillChain(
      ['/skill:a', '/skill:b'],
      [
        { name: 'a', location: '/a', content: 'A' },
        { name: 'b', location: '/b', content: 'B' },
      ],
      rest
    );
    expect(parseSkillInvocation(text)?.rest).toBe(rest);
    expect(restoreSkillCommands(text)).toBe(`/skill:a /skill:b ${rest}`);
  });
});
