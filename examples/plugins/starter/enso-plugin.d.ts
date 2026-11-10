/** Author types for native 小满 plugins (manifest schemaVersion 1). No runtime SDK is required. */
type Awaitable<T> = T | Promise<T>;
type Dispose = () => void;

export interface InvocationContext {
  sessionId: string | null;
  projectRoot: string | null;
  invocationId: string;
  signal: AbortSignal;
}

export interface DraftRevision {
  generation: string;
  rev: string;
}
export interface DraftSnapshot extends DraftRevision {
  text: string;
  hasReferences: boolean;
}
export interface DraftWrite {
  text: string;
  expect: DraftRevision;
}
export interface ComposerApi {
  readDraft(): Promise<DraftSnapshot>;
  insertText(input: DraftWrite): Promise<DraftRevision>;
  replaceDraft(input: DraftWrite): Promise<DraftRevision>;
}

export interface PluginToolResult {
  content: string;
  details?: unknown;
}
export interface TriggerCandidate {
  id: string;
  label: string;
  detail?: string;
}
export interface TriggerHandlers {
  candidates(
    query: string,
    ctx: InvocationContext
  ): Awaitable<readonly TriggerCandidate[] | null | undefined>;
  pick(
    item: TriggerCandidate,
    ctx: InvocationContext
  ): Awaitable<string | { text: string } | null | undefined>;
}
export interface PluginFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}
export interface PluginFetchResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}
export interface PluginMcpTool {
  server: string;
  name: string;
  description: string;
}

export interface PluginMainApi {
  readonly pluginId: string;
  readonly dataDir: string;
  readonly tools: {
    /** Registers a handler for a tool already declared in the manifest. */
    register(
      name: string,
      handler: (
        args: Record<string, unknown>,
        ctx: InvocationContext
      ) => Awaitable<string | PluginToolResult>
    ): Dispose;
  };
  readonly triggers: { register(name: string, handlers: TriggerHandlers): Dispose };
  readonly renderer: {
    handle(
      method: string,
      handler: (args: unknown, ctx: InvocationContext) => Awaitable<unknown>
    ): Dispose;
  };
  readonly fs: {
    readText(path: string): Promise<string>;
    writeText(path: string, text: string): Promise<null>;
  };
  readonly net: { fetch(url: string, init?: PluginFetchInit): Promise<PluginFetchResult> };
  readonly ui: { notify(title: string, body?: string): Promise<null> };
  readonly composer: ComposerApi;
  readonly config: { get(): Promise<Record<string, string>> };
  readonly mcp: {
    tools(): Promise<PluginMcpTool[]>;
    call(
      server: string,
      tool: string,
      args?: Record<string, unknown>
    ): Promise<{ content: string; isError: boolean }>;
  };
}
export type PluginActivate = (enso: PluginMainApi) => Awaitable<void>;

type SlotComponent<Props> = (props: Props) => import('react').ReactNode;
interface ComposerSlotProps {
  position: 'left' | 'right';
  sessionId: string | null;
  draft: string;
  busy: boolean;
}
export type PluginSlot =
  | { slot: 'composer.left'; component: SlotComponent<ComposerSlotProps> }
  | { slot: 'composer.right'; component: SlotComponent<ComposerSlotProps> }
  | {
      slot: 'message.action';
      position: 'right';
      component: SlotComponent<{ position: 'right'; text: string }>;
    }
  | {
      slot: 'tool.card';
      toolName: string;
      component: SlotComponent<{ toolName: string; output: string | null; state: string }>;
    }
  | {
      slot: 'block';
      language: string;
      component: SlotComponent<{ language: string; source: string }>;
    };

export interface PluginRendererApi {
  readonly React: typeof import('react');
  readonly slots: { register(entry: PluginSlot): Dispose };
  dispatch(action: 'plugin.call', payload: { method: string; args?: unknown }): Promise<unknown>;
  /** Only present if the plugin has been granted composer.draft. */
  readonly composer?: ComposerApi;
}
// biome-ignore lint/suspicious/noConfusingVoidType: onLoad may omit a return, or return cleanup.
export type PluginOnLoad = (enso: PluginRendererApi) => Awaitable<void | Dispose>;

/** `window.enso` in a plugin's sandboxed sidebar HTML, not in its ui.js. */
export interface PluginViewApi {
  readonly theme: 'light' | 'dark';
  call(method: string, args?: unknown): Promise<unknown>;
}
