import type {
  DraftRevision,
  DraftWrite,
  InvocationContext,
  PluginAgentSource,
  PluginBrowserOp,
  PluginInspectEntry,
  PluginMainApi,
  PluginRendererApi,
  PluginSlot,
  PluginToolResult,
  TriggerCandidate,
} from '../../examples/plugins/starter/enso-plugin';
import type { GateDeps } from '../main/services/extensionPlugins/gate';
import type { DraftRequest, mutateDraftReferences } from '../renderer/plugins/draftBridge';
import type { PluginSlotName } from '../renderer/plugins/registry';
import type {
  PluginBlock,
  PluginComposerSlots,
  PluginMessageActions,
  PluginToolCardSlot,
} from '../renderer/plugins/slots';
import type { PluginTriggerItem } from '../renderer/plugins/triggers';
import type { PluginInspectEntry as HostInspectEntry } from '../shared/browser/inspection';
import type { PluginBrowserOp as HostBrowserOp } from '../shared/extensionPlugins/browserBridge';
import type {
  PluginToolResult as HostToolResult,
  MainToPluginHost,
  PluginHostApi,
} from '../shared/extensionPlugins/protocol';

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Check<T extends true> = T;
type SlotProps<S extends PluginSlotName> = Parameters<
  Extract<PluginSlot, { slot: S }>['component']
>[0];
type DotMethods<T> = { [K in keyof T & string]: `${K}.${keyof T[K] & string}` }[keyof T & string];
type PublicRpc =
  | DotMethods<
      Omit<
        PluginMainApi,
        | 'pluginId'
        | 'dataDir'
        | 'tools'
        | 'renderer'
        | 'triggers'
        | 'commands'
        | 'events'
        | 'schedules'
        | 'exports'
        | 'ui'
        | 'artifacts'
        | 'plugins'
      >
    >
  | 'tool.progress'
  | 'artifact.write'
  | 'plugin.call'
  | 'contrib.register'
  | 'contrib.unregister'
  | 'ui.notify'
  | 'ui.viewEvent'
  | 'ui.viewOpen'
  | 'ui.statusUpdate'
  | 'ui.clipboard'
  | 'ui.openExternal';
type Call = Extract<MainToPluginHost, { t: 'call' }>;
type Flatten<T> = { [K in keyof T]: T[K] };

// Compiled by the root typecheck; nothing here runs or imports a plugin at runtime.
export type AuthorContract = [
  Check<Equal<PublicRpc, PluginHostApi>>,
  Check<
    Equal<
      keyof PluginMainApi,
      | 'pluginId'
      | 'dataDir'
      | 'tools'
      | 'triggers'
      | 'renderer'
      | 'fs'
      | 'net'
      | 'ui'
      | 'composer'
      | 'config'
      | 'mcp'
      | 'commands'
      | 'events'
      | 'schedules'
      | 'exports'
      | 'plugins'
      | 'artifacts'
      | 'session'
      | 'host'
      | 'browser'
    >
  >,
  Check<Equal<keyof PluginMainApi['tools'], 'register'>>,
  Check<
    Equal<
      InvocationContext,
      Flatten<
        Pick<Call, 'sessionId' | 'projectRoot' | 'invocationId'> & {
          signal: AbortSignal;
          agent: PluginAgentSource | null;
          progress(text: string): Promise<unknown>;
          caller?: string;
        }
      >
    >
  >,
  Check<Equal<PluginToolResult, HostToolResult>>,
  Check<Equal<TriggerCandidate, PluginTriggerItem>>,
  Check<Equal<ReturnType<PluginMainApi['config']['get']>, Promise<ReturnType<GateDeps['config']>>>>,
  Check<Equal<ReturnType<PluginMainApi['mcp']['tools']>, ReturnType<GateDeps['mcpTools']>>>,
  Check<Equal<ReturnType<PluginMainApi['mcp']['call']>, ReturnType<GateDeps['mcpCall']>>>,
  Check<
    Equal<
      ReturnType<PluginMainApi['browser']['invoke']>,
      ReturnType<NonNullable<GateDeps['browser']>>
    >
  >,
  Check<Equal<PluginBrowserOp, HostBrowserOp>>,
  Check<Equal<PluginInspectEntry, HostInspectEntry>>,
  Check<Equal<keyof PluginMainApi['composer'], DraftRequest['op']>>,
  Check<
    Equal<
      keyof PluginRendererApi,
      'React' | 'slots' | 'dispatch' | 'composer' | 'theme' | 'onTheme'
    >
  >,
  Check<Equal<undefined extends PluginRendererApi['composer'] ? true : false, true>>,
  Check<Equal<Parameters<PluginRendererApi['dispatch']>[0], 'plugin.call'>>,
  Check<Equal<DraftRevision, Parameters<typeof mutateDraftReferences>[1]>>,
  Check<Equal<Parameters<PluginMainApi['composer']['insertText']>[0], DraftWrite>>,
  Check<Equal<Parameters<PluginMainApi['composer']['replaceDraft']>[0], DraftWrite>>,
  Check<Equal<Parameters<NonNullable<PluginRendererApi['composer']>['insertText']>[0], DraftWrite>>,
  Check<
    Equal<Parameters<NonNullable<PluginRendererApi['composer']>['replaceDraft']>[0], DraftWrite>
  >,
  Check<Equal<DraftWrite['expect'], DraftRevision>>,
  Check<Equal<PluginSlot['slot'], PluginSlotName>>,
  Check<Equal<SlotProps<'message.action'>, Parameters<typeof PluginMessageActions>[0]>>,
  Check<
    Equal<
      SlotProps<'tool.card'>,
      Flatten<Omit<Parameters<typeof PluginToolCardSlot>[0], 'name'> & { toolName: string }>
    >
  >,
  Check<
    Equal<
      SlotProps<'block'>,
      {
        language: Parameters<typeof PluginBlock>[0]['lang'];
        source: Parameters<typeof PluginBlock>[0]['source'];
      }
    >
  >,
  Check<
    Equal<
      SlotProps<'composer.left'>,
      {
        [K in keyof Parameters<typeof PluginComposerSlots>[0] as K extends 'side'
          ? 'position'
          : K]: Parameters<typeof PluginComposerSlots>[0][K];
      }
    >
  >,
  Check<Equal<SlotProps<'composer.right'>, SlotProps<'composer.left'>>>,
];
