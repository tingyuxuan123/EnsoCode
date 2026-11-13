export type PluginSlotName =
  | 'message.action'
  | 'tool.card'
  | 'block'
  | 'composer.left'
  | 'composer.right'
  | 'thinking.body'
  | 'message.leaf';
export interface PluginSlotEntry {
  pluginId: string;
  slot: PluginSlotName;
  component: (props: Record<string, unknown>) => unknown;
  position?: 'left' | 'right';
  toolName?: string;
  language?: string;
}
let entries: PluginSlotEntry[] = [];
const slotKeys = new WeakMap<PluginSlotEntry, string>();
export const pluginSlotKey = (entry: PluginSlotEntry): string =>
  slotKeys.get(entry) ?? entry.pluginId;
let version = 0;
const listeners = new Set<() => void>();
const bump = () => {
  version++;
  for (const listener of listeners) listener();
};
export const pluginSlotsVersion = () => version;
export function subscribePluginSlots(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function registerPluginSlot(entry: PluginSlotEntry): () => void {
  if (!/^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/.test(entry.pluginId)) throw new Error('Invalid plugin id');
  if (
    ![
      'message.action',
      'tool.card',
      'block',
      'composer.left',
      'composer.right',
      'thinking.body',
      'message.leaf',
    ].includes(entry.slot)
  )
    throw new Error('Unknown slot');
  if (typeof entry.component !== 'function') throw new Error('Slot requires a component');
  if (entry.slot === 'message.action' && entry.position !== 'right' && entry.position !== 'left')
    throw new Error('Message actions require a position');
  if (
    entry.slot === 'tool.card' &&
    (!entry.toolName || !/^[a-z][a-z0-9_]*$/.test(entry.toolName) || entry.toolName.includes('__'))
  )
    throw new Error('Expected this plugin local tool name');
  if (
    entry.slot === 'block' &&
    (!entry.language || !/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(entry.language))
  )
    throw new Error('Expected local block language');
  const stored = {
    ...entry,
    ...(entry.language ? { language: entry.language.toLowerCase() } : {}),
  };
  slotKeys.set(stored, crypto.randomUUID());
  entries.push(stored);
  bump();
  return () => {
    entries = entries.filter((item) => item !== stored);
    bump();
  };
}
export function clearPluginSlots(pluginId: string): void {
  entries = entries.filter((item) => item.pluginId !== pluginId);
  bump();
}
export function resetPluginSlots(): void {
  entries = [];
  bump();
}
export const pluginMessageActions = (position: 'left' | 'right') =>
  entries.filter((item) => item.slot === 'message.action' && item.position === position);
export const pluginComposerSlots = (side: 'left' | 'right') =>
  entries.filter((item) => item.slot === `composer.${side}`);
export const pluginThinkingBody = () => entries.find((item) => item.slot === 'thinking.body');
export const pluginMessageLeaf = () => entries.find((item) => item.slot === 'message.leaf');
export const pluginToolCard = (pluginId: string, toolName: string) =>
  entries.find(
    (item) => item.slot === 'tool.card' && item.pluginId === pluginId && item.toolName === toolName
  );
export const pluginBlock = (pluginId: string, language: string) =>
  entries.find(
    (item) =>
      item.slot === 'block' &&
      item.pluginId === pluginId &&
      item.language === language.toLowerCase()
  );
export function parsePluginFence(
  language: string | undefined
): { pluginId: string; lang: string } | null {
  const match = /^([a-z][a-z0-9]*(?:\.[a-z0-9]+)+):([a-zA-Z0-9][a-zA-Z0-9_-]{0,63})$/.exec(
    language ?? ''
  );
  return match ? { pluginId: match[1], lang: match[2].toLowerCase() } : null;
}
