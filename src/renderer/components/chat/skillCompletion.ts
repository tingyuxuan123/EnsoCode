import type { SlashCommand } from '@shared/types/agent';

export function extractSkillQuery(text: string, cursor: number): string | null {
  return /(?:^|\s)\$([^\s$]*)$/.exec(text.slice(0, cursor))?.[1] ?? null;
}

/** 技能按名称调用，同名（忽略大小写）只保留先出现的一条。 */
export function dedupeSlashCommands<T extends SlashCommand>(commands: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const command of commands) {
    const key = command.name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(command);
  }
  return unique;
}

export function filterComposerCommands(
  commands: readonly SlashCommand[],
  slashQuery: string | null,
  skillQuery: string | null
): SlashCommand[] {
  const query = skillQuery ?? slashQuery;
  if (query === null) return [];
  const needle = query.toLowerCase();
  return dedupeSlashCommands(
    commands.filter((command) =>
      skillQuery !== null
        ? command.name.startsWith('/skill:') &&
          command.name.slice('/skill:'.length).toLowerCase().includes(needle)
        : command.name.toLowerCase().includes(needle)
    )
  ).slice(0, 10);
}
