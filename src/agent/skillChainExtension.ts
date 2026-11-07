import { readFileSync } from 'node:fs';
import {
  type InlineExtension,
  type Skill,
  stripFrontmatter,
} from '@earendil-works/pi-coding-agent';
import {
  formatSkillChain,
  parseLeadingSkillCommands,
  type SkillBlock,
  splitSkillCommandPrefix,
} from '@shared/skillCommands';

export function expandSkillChain(text: string, skills: readonly Skill[]): string {
  const { prefix, input } = splitSkillCommandPrefix(text);
  const { commands, rest } = parseLeadingSkillCommands(input);
  // Native Pi handles a single unprefixed skill. Its startsWith check cannot see
  // through worker plan/role envelopes, so those explicit invocations need us too.
  if (!commands.length || (commands.length < 2 && !prefix)) return text;
  const blocks: SkillBlock[] = [];
  for (const command of new Set(commands)) {
    const skill = skills.find((item) => `/skill:${item.name}` === command);
    if (!skill) continue;
    try {
      blocks.push({
        name: skill.name,
        location: skill.filePath,
        content: `References are relative to ${skill.baseDir}.\n\n${stripFrontmatter(readFileSync(skill.filePath, 'utf-8')).trim()}`,
      });
    } catch {
      // Like Pi, keep unreadable/removed commands as literal input; later skills still work.
    }
  }
  if (!blocks.length) return text;
  return prefix + formatSkillChain(commands, blocks, rest);
}

export function skillChainExtension(skills: () => readonly Skill[]): InlineExtension {
  return {
    name: 'skill-chain',
    hidden: true,
    factory: (pi) => {
      pi.on('input', (event) => {
        const text = expandSkillChain(event.text, skills());
        return text === event.text ? { action: 'continue' } : { action: 'transform', text };
      });
    },
  };
}
