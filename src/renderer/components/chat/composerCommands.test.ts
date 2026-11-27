import { describe, expect, it } from 'vitest';
import { type ComposerCommand, desktopComposerCommands } from './composerCommands';

const label = (command: ComposerCommand) => command.name;

const projectSkills = (names: readonly string[]): ComposerCommand[] =>
  names.map((name) => ({ name: `/skill:${name}`, description: '' }));

describe('desktopComposerCommands', () => {
  it('keeps every project skill visible after built-ins and session commands', () => {
    // 真实场景：仓库有 5 个项目技能，菜单前面还有内置与插件命令，
    // 曾经按总数截断 10 项，末尾的技能只能搜索到、滚不到。
    const skills = projectSkills([
      'diffs',
      'enso-cdp',
      'project-knowledge',
      'transitions-dev',
      'transitions-polish',
    ]);
    const commands: ComposerCommand[] = [
      { name: '/skill:vetta-ui-design', description: '', bundled: true },
      { name: '/goal', description: '' },
      { name: '/compact', description: '' },
      { name: '/plan', description: '' },
      { name: '/codekiln.memory:open', description: '' },
      ...skills,
    ];

    const shown = desktopComposerCommands(commands, ['image', 'plugin'], '', false, label);

    expect(shown.map((command) => command.name)).toEqual(
      expect.arrayContaining([...skills.map((skill) => skill.name)])
    );
    expect(shown).toHaveLength(commands.length + 2);
  });

  it('still narrows the list by query instead of truncating it', () => {
    const commands = projectSkills(Array.from({ length: 14 }, (_, index) => `test-${index}`));

    const shown = desktopComposerCommands(commands, [], 'test-1', false, label);

    expect(shown.map((command) => command.name)).toEqual([
      '/skill:test-1',
      '/skill:test-10',
      '/skill:test-11',
      '/skill:test-12',
      '/skill:test-13',
    ]);
  });
});
