import { describe, expect, it } from 'vitest';
import {
  ALL_GROUP_ID,
  applyProjectGroupPatch,
  filterProjectsByGroup,
  type ProjectGroup,
  sectionsForAllView,
  UNGROUPED_GROUP_ID,
} from './projectGroups';
import type { Project } from './types/project';

type P = Project & { groupId?: string };
const p = (id: string, groupId?: string): P => ({ id, name: id, path: `/${id}`, groupId });
const g = (id: string, order: number, name = id): ProjectGroup => ({ id, name, order });

interface GroupSection {
  groupId: string;
  group?: ProjectGroup;
  projects: P[];
}
const asSections = (x: unknown) => x as GroupSection[];

describe('filterProjectsByGroup', () => {
  it('ALL：返回所有未归档项目，保持原序；归档项目排除', () => {
    const projects = [p('a'), p('b'), p('c')];
    expect(filterProjectsByGroup(projects, [], [], ALL_GROUP_ID).map((x) => x.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(filterProjectsByGroup(projects, [], ['b'], ALL_GROUP_ID).map((x) => x.id)).toEqual([
      'a',
      'c',
    ]);
  });

  it('选中某组：只返回该组未归档项目', () => {
    const groups = [g('work', 1)];
    const projects = [p('a', 'work'), p('b', 'play'), p('c', 'work')];
    expect(filterProjectsByGroup(projects, groups, [], 'work').map((x) => x.id)).toEqual([
      'a',
      'c',
    ]);
    expect(filterProjectsByGroup(projects, groups, ['a'], 'work').map((x) => x.id)).toEqual(['c']);
  });

  it('UNGROUPED：无 groupId 或 groupId 不在目录的项目，排除归档', () => {
    const groups = [g('work', 1)];
    const projects = [p('a'), p('b', 'work'), p('c', 'ghost'), p('d')];
    expect(
      filterProjectsByGroup(projects, groups, [], UNGROUPED_GROUP_ID).map((x) => x.id)
    ).toEqual(['a', 'c', 'd']);
    expect(
      filterProjectsByGroup(projects, groups, ['c'], UNGROUPED_GROUP_ID).map((x) => x.id)
    ).toEqual(['a', 'd']);
  });
});

describe('sectionsForAllView', () => {
  it('组按 order 排序、空组仍有段、未分组段最后且只含活跃未入组项目、归档排除', () => {
    const groups = [g('z', 2), g('a', 1), g('empty', 3)];
    const projects = [p('p1', 'a'), p('p2', 'z'), p('u1'), p('archived', 'a')];
    const sections = asSections(sectionsForAllView(projects, groups, ['archived']));
    expect(sections.map((s) => s.groupId)).toEqual(['a', 'z', 'empty', UNGROUPED_GROUP_ID]);
    expect(sections.find((s) => s.groupId === 'a')!.projects.map((x) => x.id)).toEqual(['p1']);
    expect(sections.find((s) => s.groupId === 'empty')!.projects).toEqual([]);
    expect(
      sections.find((s) => s.groupId === UNGROUPED_GROUP_ID)!.projects.map((x) => x.id)
    ).toEqual(['u1']);
  });

  it('无未入组活跃项目时不出现未分组段', () => {
    const groups = [g('a', 1)];
    const projects = [p('p1', 'a')];
    expect(asSections(sectionsForAllView(projects, groups, [])).map((s) => s.groupId)).toEqual([
      'a',
    ]);
  });

  it('未知 groupId 的项目归入未分组段', () => {
    const groups = [g('a', 1)];
    const projects = [p('x', 'ghost')];
    const sections = asSections(sectionsForAllView(projects, groups, []));
    expect(
      sections.find((s) => s.groupId === UNGROUPED_GROUP_ID)!.projects.map((x) => x.id)
    ).toEqual(['x']);
  });
});

describe('applyProjectGroupPatch', () => {
  const group: ProjectGroup = { id: 'g', name: 'Work', order: 1, color: '#3b82f6' };

  it('只改名时保留颜色', () => {
    expect(applyProjectGroupPatch(group, { name: 'Office' })).toEqual({
      ...group,
      name: 'Office',
    });
  });

  it('color 键在但值为空则去掉颜色（编辑器点已选色取消）', () => {
    expect(applyProjectGroupPatch(group, { name: 'Work', color: undefined }).color).toBeUndefined();
    expect(applyProjectGroupPatch(group, { color: '' }).color).toBeUndefined();
    expect('color' in applyProjectGroupPatch(group, { color: undefined })).toBe(false);
  });

  it('写入新颜色', () => {
    expect(applyProjectGroupPatch(group, { color: '#22c55e' }).color).toBe('#22c55e');
  });

  it('写入与清空默认模型', () => {
    const withModel = applyProjectGroupPatch(group, {
      defaultModel: { providerId: 'p', modelId: 'm' },
    });
    expect(withModel.defaultModel).toEqual({ providerId: 'p', modelId: 'm' });
    expect(applyProjectGroupPatch(withModel, { name: 'Work' }).defaultModel).toEqual({
      providerId: 'p',
      modelId: 'm',
    });
    expect('defaultModel' in applyProjectGroupPatch(withModel, { defaultModel: null })).toBe(false);
  });

  it('写入与清空默认推理深度；清空模型时一并去掉推理字段', () => {
    const withReasoning = applyProjectGroupPatch(group, {
      defaultModel: { providerId: 'p', modelId: 'm' },
      defaultReasoningEnabled: false,
      defaultThinkingLevel: 'high',
    });
    expect(withReasoning.defaultReasoningEnabled).toBe(false);
    expect(withReasoning.defaultThinkingLevel).toBe('high');
    expect(applyProjectGroupPatch(withReasoning, { name: 'Work' }).defaultThinkingLevel).toBe(
      'high'
    );
    const cleared = applyProjectGroupPatch(withReasoning, { defaultModel: null });
    expect('defaultModel' in cleared).toBe(false);
    expect('defaultReasoningEnabled' in cleared).toBe(false);
    expect('defaultThinkingLevel' in cleared).toBe(false);
  });
});
