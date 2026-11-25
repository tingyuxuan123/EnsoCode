import type { SlashCommand } from '@shared/types/agent';
import { dedupeSlashCommands } from './skillCompletion';

export interface ComposerCommand extends SlashCommand {
  bundled?: true;
  prompt?: ComposerCommandPrompt;
}

export type ComposerCommandPrompt = 'image' | 'plugin';

export const COMMAND_PROMPTS = {
  image: {
    name: '/image',
    label: 'Image generation',
    description: 'Describe a picture, poster, or wallpaper to generate in this conversation.',
    usage: 'Describe the subject, style, and dimensions.',
    template: 'Generate an image: ',
  },
  plugin: {
    name: '/plugin',
    label: 'Build your own plugin',
    description: 'Describe what a CodeKiln plugin should do and where people will use it.',
    usage: 'Describe the purpose of the plugin and where it should appear.',
    template: 'Help me build a CodeKiln plugin: ',
  },
} as const;

export const VETTA_SKILL_COMMAND = '/skill:vetta-ui-design';

export function isVettaCommand(command: ComposerCommand): boolean {
  return command.bundled === true && command.name === VETTA_SKILL_COMMAND;
}

export function commandGroup(command: ComposerCommand): 0 | 1 | 2 {
  if (command.bundled || command.prompt) return 0;
  return command.name.startsWith('/skill:') ? 2 : 1;
}

export function desktopComposerCommands(
  commands: readonly ComposerCommand[],
  prompts: readonly ComposerCommandPrompt[],
  query: string,
  skillOnly: boolean,
  labels: (command: ComposerCommand) => string
): ComposerCommand[] {
  const needle = query.toLowerCase();
  return dedupeSlashCommands<ComposerCommand>([
    ...commands,
    ...prompts.map((prompt) => ({ ...COMMAND_PROMPTS[prompt], prompt })),
  ])
    .filter((command) => {
      const isSkill = command.name.startsWith('/skill:');
      if (skillOnly && !isSkill) return false;
      const name = skillOnly ? command.name.slice('/skill:'.length) : command.name;
      return [name, labels(command)].some((value) => value.toLowerCase().includes(needle));
    })
    .sort(
      (a, b) =>
        commandGroup(a) - commandGroup(b) || Number(Boolean(b.bundled)) - Number(Boolean(a.bundled))
    )
    .slice(0, 10);
}

export const SESSION_COMMAND_DETAILS: Partial<
  Record<string, { label: string; description: string; usage: string; options?: readonly string[] }>
> = {
  '/goal': {
    label: 'Set a session goal',
    description: 'Set the objective for this conversation. You can pause it and resume it later.',
    usage: '/goal <objective>',
    options: ['pause', 'resume', 'clear'],
  },
  '/compact': {
    label: 'Compact context',
    description:
      'Compact the conversation context. Optionally tell the agent what to preserve in the summary.',
    usage: '/compact [summary focus]',
  },
  '/plan': {
    label: 'Enter plan mode',
    description: 'Let the agent investigate read-only and submit a plan before carrying it out.',
    usage: '/plan [task]',
    options: ['off'],
  },
};
