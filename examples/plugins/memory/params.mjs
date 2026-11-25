import { isObject } from './domain.mjs';

const OPTIONAL = {
  memory_write: ['target', 'kind', 'scope', 'pinned', 'id'],
  memory_read: ['target', 'date', 'id', 'kind', 'scope', 'done', 'limit', 'offset'],
  memory_search: ['query', 'sources', 'kind', 'limit', 'offset'],
  memory_forget: ['target'],
  memory_restore: [],
  scratchpad: ['action', 'text', 'id', 'scope', 'limit', 'offset'],
  memory_status: [],
};

/** Schemas explicitly accept null/empty optional placeholders, before this semantic normalization. */
export function normalizeArguments(name, input) {
  if (!isObject(input)) throw new Error('工具参数必须为对象');
  const args = { ...input };
  for (const key of OPTIONAL[name] ?? []) {
    if (
      args[key] === null ||
      (typeof args[key] === 'string' && !args[key].trim()) ||
      (key === 'sources' && Array.isArray(args[key]) && !args[key].length)
    )
      delete args[key];
  }
  return args;
}
