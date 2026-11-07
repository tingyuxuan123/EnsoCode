import { parseLeadingSkillCommands } from '@shared/skillCommands';

export function slashChain(slash: string | null): string[] {
  if (!slash) return [];
  const parsed = parseLeadingSkillCommands(slash);
  return parsed.commands.length && !parsed.rest ? parsed.commands : [slash];
}

export function appendSlash(current: string | null, next: string): string {
  const commands = slashChain(current);
  if (!next.startsWith('/skill:') || commands.some((item) => !item.startsWith('/skill:')))
    return next;
  return [...new Set([...commands, next])].join(' ');
}

export function removeSlash(slash: string, index: number): string | null {
  return (
    slashChain(slash)
      .filter((_, position) => position !== index)
      .join(' ') || null
  );
}

export function foldLeadingSkills(
  text: string,
  slash: string | null
): { slash: string; rest: string } | null {
  if (slash && !slash.startsWith('/skill:')) return null;
  const parsed = parseLeadingSkillCommands(text);
  if (!parsed.commands.length || (!parsed.rest && !/\s$/.test(text))) return null;
  return { slash: parsed.commands.reduce<string | null>(appendSlash, slash)!, rest: parsed.rest };
}
