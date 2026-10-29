import type { InlineExtension, ToolInfo } from '@earendil-works/pi-coding-agent';
import { oneLine } from './mcpNames';

export type CatalogTool = Pick<ToolInfo, 'name' | 'description' | 'namespace'>;

const TOOL_LINE_MAX = 160;
const SUMMARY_MAX = 300;
const CATALOG_MAX = 7600;
const BUILT_IN = 'built-in';
const INTRO = [
  'Tool discovery index, grouped by source (enabled tools without a prompt snippet).',
  'Use this index only for discovery; tool schemas, prompt guidelines and model-selection guidance remain authoritative.',
  'Code navigation (when available): known path → read; exact symbol → grep; unknown behavior → code_search.',
].join('\n');

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function firstSentence(text: string): string {
  const line = oneLine(text, 1000);
  const end = line.search(/[。！？]|[.!?](?=\s|$)/);
  return end < 0 ? line : line.slice(0, end + 1);
}

/** 仅补充无 snippet 的已激活工具；整个段（含省略汇总）有界，来源和工具排序稳定。 */
export function renderToolCatalogSection(tools: readonly CatalogTool[]): string | undefined {
  if (tools.length === 0) return undefined;
  const groups = new Map<string, CatalogTool[]>();
  for (const item of tools) {
    const key = item.namespace?.name ?? BUILT_IN;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const keys = [...groups.keys()].sort((a, b) =>
    a === b ? 0 : a === BUILT_IN ? 1 : b === BUILT_IN ? -1 : compare(a, b)
  );
  let section = INTRO;
  const skipped: string[] = [];
  for (const key of keys) {
    const group = groups.get(key)!;
    const summary = group.map((item) => item.namespace?.description ?? '').sort(compare)[0];
    const header = oneLine(
      `${key}${summary && summary !== key ? ` — ${summary}` : ''}`,
      TOOL_LINE_MAX
    );
    let headed = false;
    for (const item of [...group].sort((a, b) => compare(a.name, b.name))) {
      const row = oneLine(
        `- ${oneLine(item.name, 64)}: ${firstSentence(item.description)}`,
        TOOL_LINE_MAX
      );
      const addition = headed ? `\n${row}` : `\n\n${header}\n${row}`;
      // 预留一行汇总，不能在超预算后才追加导致总量越界。
      if (skipped.length > 0 || section.length + addition.length > CATALOG_MAX - SUMMARY_MAX - 1) {
        skipped.push(oneLine(item.name, 64));
        continue;
      }
      section += addition;
      headed = true;
    }
  }
  if (skipped.length > 0) {
    section += `\n${oneLine(`+${skipped.length} more: ${skipped.join(', ')}`, SUMMARY_MAX)}`;
  }
  return section;
}

export const promptCatalogExtension = {
  name: 'prompt-catalog',
  hidden: true,
  factory: (pi) => {
    pi.on('before_agent_start', (event) => {
      const options = event.systemPromptOptions;
      const active = new Set(options.selectedTools);
      const extra = pi
        .getAllTools()
        .filter((item) => active.has(item.name) && !Object.hasOwn(options.toolSnippets, item.name));
      const catalog = renderToolCatalogSection(extra);
      if (catalog) options.sections.tool_catalog = catalog;
      else delete options.sections.tool_catalog;
    });
  },
} satisfies InlineExtension;
