import { parsePluginToolName } from '@shared/extensionPlugins/toolName';
import type { ReactNode } from 'react';
import { PluginSlotView } from './loader';
import {
  pluginBlock,
  pluginComposerSlots,
  pluginMessageActions,
  pluginSlotKey,
  pluginThinkingBody,
  pluginToolCard,
} from './registry';
import { usePluginSlotsVersion } from './usePluginSlots';

export function PluginMessageActions({
  position,
  text,
  messageIndex,
  sessionId,
}: {
  position: 'left' | 'right';
  text: string;
  messageIndex?: number;
  sessionId?: string | null;
}) {
  usePluginSlotsVersion();
  return (
    <>
      {pluginMessageActions(position).map((entry) => (
        <PluginSlotView
          key={pluginSlotKey(entry)}
          entry={entry}
          props={{ position, text, messageIndex, sessionId }}
        />
      ))}
    </>
  );
}
export function PluginThinkingBody({
  text,
  streaming,
  itemKey,
}: {
  text: string;
  streaming: boolean;
  itemKey: string;
}) {
  usePluginSlotsVersion();
  const entry = pluginThinkingBody();
  return entry ? (
    <PluginSlotView
      entry={entry}
      props={{ text, streaming, itemKey }}
      fallback={text}
      retryPhase={streaming}
    />
  ) : (
    text
  );
}
export function PluginMessageLeaf({
  entry,
  source,
  final,
  messageIndex,
  sessionId,
  Markdown,
}: {
  entry: import('./registry').PluginSlotEntry;
  source: string;
  final: boolean;
  messageIndex: number;
  sessionId: string | null;
  Markdown: (props: { text: string }) => unknown;
}) {
  return (
    <PluginSlotView
      entry={entry}
      props={{ source, final, messageIndex, sessionId, Markdown }}
      retryPhase={final}
    />
  );
}
export function PluginToolCardSlot({
  name,
  output,
  state,
}: {
  name: string;
  output: string | null;
  state: string;
}) {
  usePluginSlotsVersion();
  const parsed = parsePluginToolName(name);
  const entry = parsed && pluginToolCard(parsed.pluginId, parsed.toolName);
  return entry && parsed ? (
    <PluginSlotView
      entry={entry}
      props={{ toolName: parsed.toolName, output, state }}
      retryPhase={state}
    />
  ) : null;
}
export function PluginBlock({
  pluginId,
  lang,
  source,
  streaming = false,
  fallback = null,
}: {
  pluginId: string;
  lang: string;
  source: string;
  streaming?: boolean;
  fallback?: ReactNode;
}) {
  usePluginSlotsVersion();
  const entry = pluginBlock(pluginId, lang);
  return entry ? (
    <PluginSlotView
      entry={entry}
      props={{ language: lang, source }}
      fallback={fallback}
      retryPhase={streaming}
    />
  ) : (
    fallback
  );
}
export function PluginComposerSlots({
  side,
  sessionId,
  draft,
  busy,
  presetId,
}: {
  side: 'left' | 'right';
  sessionId: string | null;
  draft: string;
  busy: boolean;
  presetId?: string;
}) {
  usePluginSlotsVersion();
  return (
    <>
      {pluginComposerSlots(side).map((entry) => (
        <PluginSlotView
          key={pluginSlotKey(entry)}
          entry={entry}
          props={{ position: side, sessionId, draft, busy, presetId }}
        />
      ))}
    </>
  );
}
