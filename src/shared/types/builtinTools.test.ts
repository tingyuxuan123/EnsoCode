import { describe, expect, it } from 'vitest';
import {
  addComputerDefaultOff,
  BUILTIN_TOOLS,
  DEFAULT_DISABLED_BUILTIN_TOOLS,
  effectiveDisabledBuiltinTools,
  effectiveSubagentAllowedModes,
  isBuiltinToolEnabledForProject,
  isWorkflowAvailable,
  persistedSettingsState,
  projectDisabledBuiltinTools,
  resolveDisabledBuiltinTools,
} from './builtinTools';

describe('isWorkflowAvailable', () => {
  it('code_search 注册为内置工具且新安装默认关闭', () => {
    expect(BUILTIN_TOOLS.some((tool) => tool.id === 'code_search')).toBe(true);
    expect(effectiveDisabledBuiltinTools(undefined)).toContain('code_search');
  });
  it('workflow 靠 subagent 派发子代理，两者任一关闭都不可用', () => {
    expect(isWorkflowAvailable([])).toBe(true);
    expect(isWorkflowAvailable(['memory'])).toBe(true);
    expect(isWorkflowAvailable(['workflow'])).toBe(false);
    expect(isWorkflowAvailable(['subagent'])).toBe(false);
  });
});

describe('isBuiltinToolEnabledForProject', () => {
  const projects = [{ id: 'p1', disabledBuiltinTools: ['plan'] }, { id: 'p2' }];

  it('plan 是可开关的内置工具，默认开启', () => {
    expect(BUILTIN_TOOLS.some((tool) => tool.id === 'plan')).toBe(true);
    expect(isBuiltinToolEnabledForProject(undefined, [], 'p2', 'plan')).toBe(true);
  });

  it('项目覆盖优先，未覆盖跟全局', () => {
    expect(isBuiltinToolEnabledForProject([], projects, 'p1', 'plan')).toBe(false);
    expect(isBuiltinToolEnabledForProject(['plan'], projects, 'p2', 'plan')).toBe(false);
    expect(isBuiltinToolEnabledForProject([], projects, 'p2', 'plan')).toBe(true);
  });
});

describe('effectiveDisabledBuiltinTools', () => {
  it('缺字段时使用默认关闭列表', () => {
    expect(effectiveDisabledBuiltinTools(undefined)).toEqual(['memory', 'computer', 'code_search']);
    for (const id of DEFAULT_DISABLED_BUILTIN_TOOLS) {
      expect(
        BUILTIN_TOOLS.some((tool) => tool.id === id),
        id
      ).toBe(true);
    }
  });

  it('用户显式存了空列表 = 全开（不重新叠加默认关闭）', () => {
    expect(effectiveDisabledBuiltinTools([])).toEqual([]);
  });

  it('只保留字符串 id，列表原样透传', () => {
    expect(effectiveDisabledBuiltinTools(['browser', 1, 'isolated_sandbox'])).toEqual([
      'browser',
      'isolated_sandbox',
    ]);
  });
});

describe('effectiveSubagentAllowedModes', () => {
  it('新配置按 mode 掩码收窄并去重，脏值不扩权', () => {
    expect(effectiveSubagentAllowedModes(['coworker', 'task', 'coworker'], [])).toEqual([
      'task',
      'coworker',
    ]);
    expect(effectiveSubagentAllowedModes(['invalid'], [])).toEqual([]);
  });

  it('未迁移配置按旧两个开关保守推导 mode', () => {
    expect(effectiveSubagentAllowedModes(undefined, [])).toEqual(['task', 'coworker']);
    expect(effectiveSubagentAllowedModes(undefined, ['coworker'])).toEqual(['task']);
    expect(effectiveSubagentAllowedModes(undefined, ['subagent'])).toEqual(['coworker']);
    expect(effectiveSubagentAllowedModes(undefined, ['subagent', 'coworker'])).toEqual([]);
  });
});

describe('resolveDisabledBuiltinTools', () => {
  it('缺项目覆盖时用全局列表', () => {
    expect(resolveDisabledBuiltinTools(['browser'])).toEqual(['browser']);
    expect(resolveDisabledBuiltinTools(['browser'], undefined)).toEqual(['browser']);
    expect(resolveDisabledBuiltinTools(['browser'], {})).toEqual(['browser']);
  });

  it('项目存了列表则覆盖全局（空列表 = 本项目全开）', () => {
    expect(
      resolveDisabledBuiltinTools(['browser', 'memory'], { disabledBuiltinTools: ['subagent'] })
    ).toEqual(['subagent']);
    expect(resolveDisabledBuiltinTools(['memory'], { disabledBuiltinTools: [] })).toEqual([]);
  });

  it('项目字段不是数组时仍跟全局，不把脏值当成覆盖', () => {
    expect(resolveDisabledBuiltinTools(['browser'], { disabledBuiltinTools: 'memory' })).toEqual([
      'browser',
    ]);
  });
});

describe('projectDisabledBuiltinTools', () => {
  const projects = [{ id: 'p1', disabledBuiltinTools: ['browser'] }, { id: 'p2' }];

  it('按 id 取出项目覆盖，找不到或未覆盖返回 undefined', () => {
    expect(projectDisabledBuiltinTools(projects, 'p1')).toEqual(['browser']);
    expect(projectDisabledBuiltinTools(projects, 'p2')).toBeUndefined();
    expect(projectDisabledBuiltinTools(projects, 'missing')).toBeUndefined();
    expect(projectDisabledBuiltinTools(projects, undefined)).toBeUndefined();
    expect(projectDisabledBuiltinTools(undefined, 'p1')).toBeUndefined();
  });
});

describe('addComputerDefaultOff', () => {
  it('全局与项目覆盖的已落盘禁用列表都补上 computer，不捏造缺失字段', () => {
    expect(
      addComputerDefaultOff({
        theme: 'dark',
        disabledBuiltinTools: ['memory'],
        projects: [
          { id: 'p1', disabledBuiltinTools: ['browser'] },
          { id: 'p2', disabledBuiltinTools: ['computer'] },
          { id: 'p3' },
          null,
        ],
      })
    ).toEqual({
      theme: 'dark',
      disabledBuiltinTools: ['memory', 'computer'],
      projects: [
        { id: 'p1', disabledBuiltinTools: ['browser', 'computer'] },
        { id: 'p2', disabledBuiltinTools: ['computer'] },
        { id: 'p3' },
        null,
      ],
    });
    expect(addComputerDefaultOff({ theme: 'dark' })).toEqual({ theme: 'dark' });
  });
});

describe('persistedSettingsState webSearchChain 收窄', () => {
  it.each([undefined, null, '17', Number.NaN, Number.POSITIVE_INFINITY, -1, 17.5])(
    '脏版本 %s 不绕过 code_search 默认关闭',
    (version) => {
      expect(
        persistedSettingsState({ state: { disabledBuiltinTools: [] }, version })
          ?.disabledBuiltinTools
      ).toContain('code_search');
    }
  );

  it('v17 之前全局与项目列表缺 code_search 时保守关闭，不覆盖新版显式授权', () => {
    const state = {
      disabledBuiltinTools: ['browser'],
      projects: [{ id: 'p1', disabledBuiltinTools: [] }, { id: 'p2' }, null],
    };
    expect(persistedSettingsState({ state, version: 16 })).toEqual({
      disabledBuiltinTools: ['browser', 'code_search'],
      projects: [{ id: 'p1', disabledBuiltinTools: ['code_search'] }, { id: 'p2' }, null],
    });
    expect(persistedSettingsState({ state, version: 17 })).toEqual(state);
    expect(persistedSettingsState({ state: {}, version: 16 })).toEqual({});
    expect(state.projects[0]).toEqual({ id: 'p1', disabledBuiltinTools: [] });
  });
  it('脏数据收窄为空链；合法链透传', () => {
    expect(
      persistedSettingsState({ state: { webSearchChain: 'garbage' }, version: 99 })?.webSearchChain
    ).toEqual([]);
    expect(
      persistedSettingsState({
        state: { webSearchChain: [{ providerId: 'ga', modelId: 'm' }, { bad: true }] },
        version: 99,
      })?.webSearchChain
    ).toEqual([{ providerId: 'ga', modelId: 'm' }]);
    // 缺省字段保持缺失（不向老数据注入新键）；读取方自行 parse 缺省为空链
    expect(persistedSettingsState({ state: {}, version: 99 })).not.toHaveProperty('webSearchChain');
  });
});
