import type { SubagentModelOption } from '@shared/types/agent';

/**
 * 设置页为每个可选模型写的选型描述，渲染成「name: description」清单。
 * subagent / workflow 两个工具的 model 参数说明与使用准则共用，模型只看工具 schema 选型。
 */
export function subagentModelGuide(
  models: readonly Pick<SubagentModelOption, 'name' | 'description'>[]
): string {
  return models
    .map((model) => ({ name: model.name, description: model.description?.trim() }))
    .filter((model) => model.description)
    .map((model) => `${model.name}: ${model.description}`)
    .join('; ');
}
