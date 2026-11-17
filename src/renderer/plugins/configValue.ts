import { type PluginConfigType, parsePluginModelChoice } from '@shared/extensionPlugins/manifest';
export const formatConfigValue = (value: string | number | boolean | null | undefined) =>
  value == null ? '' : String(value);
export function coerceConfigValue(
  field: { type: PluginConfigType; min?: number; max?: number; options?: string[] },
  input: string | boolean | null
): { ok: true; value: string | number | boolean | null } | { ok: false; error: string } {
  if (input === null) return { ok: true, value: null };
  if (field.type === 'boolean') {
    if (typeof input === 'boolean') return { ok: true, value: input };
    if (input === 'true' || input === 'false') return { ok: true, value: input === 'true' };
    return { ok: false, error: 'Expected a boolean' };
  }
  if (typeof input !== 'string') return { ok: false, error: 'Invalid configuration value' };
  if (field.type === 'number') {
    const value = Number(input.trim());
    if (
      !/^-?\d+(\.\d+)?$/.test(input.trim()) ||
      !Number.isFinite(value) ||
      (field.min !== undefined && value < field.min) ||
      (field.max !== undefined && value > field.max)
    )
      return { ok: false, error: 'Number is outside the allowed range' };
    return { ok: true, value };
  }
  if (field.type === 'enum' && !field.options?.includes(input))
    return { ok: false, error: 'Choose an allowed option' };
  // 模型选择是 `<providerId>::<modelId>` 或 session/title，不能把随便一个字符串当模型存
  if (field.type === 'model' && !parsePluginModelChoice(input))
    return { ok: false, error: 'Choose a model from the list' };
  if (input.includes('\0') || input.length > 4096)
    return { ok: false, error: 'Invalid configuration value' };
  return { ok: true, value: input };
}
