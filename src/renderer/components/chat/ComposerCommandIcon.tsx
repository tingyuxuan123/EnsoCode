import {
  ClipboardList,
  ImagePlus,
  Minimize2,
  Puzzle,
  SlashSquare,
  Sparkles,
  Target,
} from 'lucide-react';
import vettaMark from '@/features/design/vetta/icon.png';
import { cn } from '@/lib/utils';
import { type ComposerCommand, isVettaCommand } from './composerCommands';

export function ComposerCommandIcon({ command }: { command: ComposerCommand }) {
  const size = 'size-[calc(16rem/14)] shrink-0';
  if (isVettaCommand(command)) {
    return <img src={vettaMark} alt="" className="size-[calc(20rem/14)] shrink-0" />;
  }
  const Icon =
    command.prompt === 'image'
      ? ImagePlus
      : command.prompt === 'plugin'
        ? Puzzle
        : command.name === '/goal'
          ? Target
          : command.name === '/compact'
            ? Minimize2
            : command.name === '/plan'
              ? ClipboardList
              : command.name.startsWith('/skill:')
                ? Sparkles
                : SlashSquare;
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        size,
        command.prompt === 'image'
          ? 'text-info'
          : command.prompt === 'plugin'
            ? 'text-warning'
            : 'text-muted-foreground'
      )}
    />
  );
}
