import { describe, expect, it } from 'vitest';
import { createEditorPayload } from './mentionComposer';
import { splitSlashCommand } from './SlashChip';
import { appendSlash, foldLeadingSkills, removeSlash, slashChain } from './slashChain';

describe('多技能chip状态保持既有单string协议', () => {
  it('连续选择追加技能，重复不新增chip', () => {
    expect(appendSlash('/skill:a', '/skill:b')).toBe('/skill:a /skill:b');
    expect(appendSlash('/skill:a /skill:b', '/skill:a')).toBe('/skill:a /skill:b');
    expect(slashChain('/skill:a /skill:b')).toEqual(['/skill:a', '/skill:b']);
    expect(removeSlash('/skill:a /skill:b', 0)).toBe('/skill:b');
    expect(removeSlash('/skill:a', 0)).toBeNull();
  });
  it('普通命令互斥，不错误组成模板数组', () => {
    expect(appendSlash('/help', '/skill:a')).toBe('/skill:a');
    expect(appendSlash('/skill:a /skill:b', '/help')).toBe('/help');
    expect(splitSlashCommand('/template /skill:a')).toEqual({
      slash: '/template',
      rest: '/skill:a',
    });
  });
  it('粘贴和发送连续技能保留顺序及完整剩余正文', () => {
    expect(splitSlashCommand('/skill:a /skill:b 任务 /skill:c')).toEqual({
      slash: '/skill:a /skill:b',
      rest: '任务 /skill:c',
    });
    expect(
      createEditorPayload({
        segments: [{ type: 'text', text: '任务' }],
        images: [],
        slash: '/skill:a /skill:b',
      }).text
    ).toBe('/skill:a /skill:b 任务');
  });
  it('只折叠已结束的开头技能token，保留正在输入的名称和后续mention', () => {
    expect(foldLeadingSkills('/skill:a /skill:b Task', null)).toEqual({
      slash: '/skill:a /skill:b',
      rest: 'Task',
    });
    expect(foldLeadingSkills('/skill:partial', '/skill:a')).toBeNull();
    expect(foldLeadingSkills('/skill:中文 ', '/skill:a')).toEqual({
      slash: '/skill:a /skill:中文',
      rest: '',
    });
    expect(foldLeadingSkills('body /skill:b ', '/skill:a')).toBeNull();
    expect(foldLeadingSkills('/skill:b ', '/template')).toBeNull();
  });
});
