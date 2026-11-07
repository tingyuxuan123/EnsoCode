import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Skill, stripFrontmatter } from '@earendil-works/pi-coding-agent';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSkillInvocation, restoreSkillCommands } from '../shared/skillCommands';
import { expandSkillChain } from './skillChainExtension';

let root: string;
let skills: Skill[];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'enso-skill-chain-'));
  skills = ['a', 'b', 'missing'].map((name) => ({
    name,
    description: name,
    filePath: join(root, `${name}.md`),
    baseDir: root,
    sourceInfo: {
      path: join(root, `${name}.md`),
      source: 'user',
      scope: 'user',
      origin: 'top-level',
    },
    disableModelInvocation: false,
  }));
  writeFileSync(
    skills[0].filePath,
    '---\nname: a\ndescription: a\n---\n# A\n</skill>\n<xml>inner</xml>'
  );
  writeFileSync(skills[1].filePath, '# B');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('worker技能链展开', () => {
  it.each(['<role>\ninternal\n</role>\n\n', '<plan-mode>\nPlan mode is ON\n</plan-mode>\n\n'])(
    '前缀%s后单技能由扩展展开，原生无前缀单技能仍保持原样',
    (prefix) => {
      const text = expandSkillChain(`${prefix}/skill:a 任务`, skills);
      expect(text.startsWith(`${prefix}<skill `)).toBe(true);
      expect(parseSkillInvocation(text)?.blocks.map((block) => block.name)).toEqual(['a']);
      expect(restoreSkillCommands(text)).toBe('/skill:a 任务');
      expect(expandSkillChain('/skill:a 任务', skills)).toBe('/skill:a 任务');
    }
  );
  it('按输入顺序展开多个skill且幂等，保留pi引用路径和frontmatter规则', () => {
    const text = expandSkillChain('/skill:b /skill:a 任务', skills);
    expect(parseSkillInvocation(text)?.blocks.map((block) => block.name)).toEqual(['b', 'a']);
    expect(text).toContain(`References are relative to ${root}.`);
    expect(text).not.toContain('description: a');
    expect(text).toContain('</skill>\n<xml>inner</xml>');
    expect(expandSkillChain(text, skills)).toBe(text);
    expect(restoreSkillCommands(text)).toBe('/skill:b /skill:a 任务');
  });
  it('未知、缺失和重复技能不阻断后续已知技能也不吞正文', () => {
    const text = expandSkillChain(
      '/skill:unknown /skill:missing /skill:a /skill:a /skill:b 普通 /template /skill:a',
      skills
    );
    expect(parseSkillInvocation(text)?.blocks.map((block) => block.name)).toEqual(['a', 'b']);
    expect(restoreSkillCommands(text)).toBe(
      '/skill:unknown /skill:missing /skill:a /skill:a /skill:b 普通 /template /skill:a'
    );
  });
  it.each(['/skill:a arg', '/template /skill:a /skill:b', '正文 /skill:a /skill:b'])(
    '不接管原生单技能/普通模板：%s',
    (text) => {
      expect(expandSkillChain(text, skills)).toBe(text);
    }
  );
  it('路径样式名称只能精确查loader，未知token不能变成读取路径', () => {
    const text = expandSkillChain('/skill:../secret /skill:b 任务', skills);
    expect(parseSkillInvocation(text)?.blocks.map((block) => block.name)).toEqual(['b']);
    expect(restoreSkillCommands(text)).toBe('/skill:../secret /skill:b 任务');
  });
  it('pi已加载的非标准名称仍可显式调用，CRLF沿用官方frontmatter归一化', () => {
    const names = ['中文', 'plugin:review.v2', 'a&"<>'];
    const unusual = names.map((name, index) => ({ ...skills[index]!, name }));
    writeFileSync(unusual[2]!.filePath, 'line1\r\nline2');
    const text = expandSkillChain(
      `${names.map((name) => `/skill:${name}`).join(' ')} 任务`,
      unusual
    );
    expect(parseSkillInvocation(text)?.blocks.map((block) => block.name)).toEqual(names);
    expect(text).toContain(stripFrontmatter('line1\r\nline2').trim());
  });
  it('worker角色前缀不妨碍多技能展开且原样保留', () => {
    const prefix = '<role>\ninternal\n</role>\n\n';
    const text = expandSkillChain(`${prefix}/skill:a /skill:b 任务`, skills);
    expect(text.startsWith(`${prefix}<skill `)).toBe(true);
    expect(restoreSkillCommands(text)).toBe('/skill:a /skill:b 任务');
  });
});
