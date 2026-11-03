import { opendir } from 'node:fs/promises';
import { join } from 'node:path';
import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { DESIGN_TOOL_NAMES, type DesignToolName } from '@shared/types/design';

/** Upstream tool-gate.ts: skill activation is NOT a gate input. */
export function designToolNames(enabled: boolean, present: boolean): readonly DesignToolName[] {
  return !enabled ? [] : present ? DESIGN_TOOL_NAMES : ['vetd_create', 'vetd_sizes'];
}
/** Equivalent to upstream discover.pickDesignPaths, including orphan v1 sidecars. */
export function isDesignPath(rel: string): boolean {
  if (rel.endsWith('.vetd/design.json') || rel.endsWith('.vetd.d/design.json')) return true;
  return !rel.includes('.vetd/') && !rel.includes('.vetd.d/') && rel.endsWith('.vetd');
}

export class DesignPresence {
  private readonly cache = new Map<string, { value: Promise<boolean>; at: number }>();
  private canvasCwds = new Set<string>();
  constructor(
    private readonly limits: {
      maxEntries?: number;
      maxDepth?: number;
      /** "No design" expires so a design cloned/copied in mid-session opens the gate. */
      negativeTtlMs?: number;
      now?: () => number;
    } = {}
  ) {}
  created(cwd: string): void {
    this.cache.set(cwd, { value: Promise.resolve(true), at: this.now() });
  }
  setCanvasCwds(cwds: readonly string[]): void {
    this.canvasCwds = new Set(cwds);
  }
  async has(cwd: string): Promise<boolean> {
    // Upstream getCanvasController shortcut; closing a canvas does not create a positive disk cache.
    if (this.canvasCwds.has(cwd)) return true;
    const cached = this.cache.get(cwd);
    if (cached) {
      const present = await cached.value;
      // created() may have replaced the entry while we awaited an older scan.
      if (this.cache.get(cwd) !== cached) return this.has(cwd);
      const expired = this.now() - cached.at >= (this.limits.negativeTtlMs ?? 30_000);
      // Positive answers stay: hiding tools mid-session would only confuse the model.
      if (present || !expired) return present;
    }
    const entry = { value: this.scan(cwd).catch(() => false), at: this.now() };
    this.cache.set(cwd, entry);
    return entry.value;
  }
  private now(): number {
    return (this.limits.now ?? Date.now)();
  }
  private async scan(cwd: string): Promise<boolean> {
    let remaining = this.limits.maxEntries ?? 10_000;
    const walk = async (rel: string, depth: number): Promise<boolean> => {
      if (remaining <= 0 || depth > (this.limits.maxDepth ?? 32)) return false;
      const dir = await opendir(join(cwd, rel)).catch(() => null);
      if (!dir) return false;
      for await (const entry of dir) {
        if (--remaining < 0) return false;
        if (
          entry.name.startsWith('.') ||
          ['node_modules', 'dist', 'build', 'target', 'vendor'].includes(entry.name)
        )
          continue;
        const file = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isFile() && isDesignPath(file)) return true;
        if (entry.isDirectory() && (await walk(file, depth + 1))) return true;
        // Dirent symlinks are never traversed; presence is a visibility hint, not path authority.
      }
      return false;
    };
    return walk('', 0);
  }
}

// Upstream creed.ts, CREED_LINE/CREED_CHECK. Only the user's intent outranks visual defaults.
export const DESIGN_CREED =
  "Core principles — they outrank the style defaults; only the user's words outrank them (if the user asks for or clearly implies the opposite, follow the user and say in one line which one you broke): 1 one thing seen first · 2 space and alignment, not lines and boxes · 3 held objects with light, grain and an edge · 4 built from what only this product has · 5 real data, pictures and words · 6 one bold move, the rest quiet · 7 type with character and a real size step · 8 colour with a source.\nThen ask of the image: is one thing seen first? does the structure survive without lines? does the hero object look held? is it this product's, not the category's? is every number real? can you name the one bold move? do heading and body sound different? can you say where each colour comes from? Fix what fails, unless the user asked for it.";

/** Canvas presence is replayed by Main; otherwise discover/create decides tool visibility. */
export function designGateExtension(options: {
  cwd: string;
  enabled(): boolean;
  presence: DesignPresence;
  apply(names: readonly DesignToolName[]): void;
  prompt?(text: string): void;
}): InlineExtension {
  return {
    name: 'design-tool-gate',
    hidden: true,
    factory: (pi) => {
      pi.on('before_agent_start', async (event) => {
        const enabled = options.enabled();
        if (enabled && event.messageType === 'user') options.prompt?.(event.prompt);
        const present = enabled && (await options.presence.has(options.cwd));
        options.apply(designToolNames(enabled, present));
        // Recompute selectedTools before catalog/persona build; do not replace the pi prompt.
        event.systemPromptOptions.selectedTools = pi.getActiveTools();
        if (present) event.systemPromptOptions.sections.vetd_core_principles = DESIGN_CREED;
        else delete event.systemPromptOptions.sections.vetd_core_principles;
      });
    },
  };
}
