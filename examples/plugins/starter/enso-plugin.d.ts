/** Author types for native 小满 plugins (manifest schemaVersion 1). No runtime SDK is required. */
type Awaitable<T> = T | Promise<T>;
type Dispose = () => void;

export interface InvocationContext {
  sessionId: string | null;
  projectRoot: string | null;
  invocationId: string;
  signal: AbortSignal;
  agent: PluginAgentSource | null;
  progress(text: string): Promise<unknown>;
  caller?: string;
}
export interface PluginAgentSource {
  kind: 'subagent' | 'coworker';
  sessionId: string;
  name: string;
  agentType?: string;
}
export interface PluginArtifactInfo {
  id: string;
  pluginId: string;
  name: string;
  mime: string;
  size: number;
  createdAt: number;
}
export interface PluginHostCapabilities {
  host: 'desktop' | 'server';
  hostVersion: string;
  notify: boolean;
  mcp: boolean;
  clipboard: boolean;
  openExternal: boolean;
  composer: boolean;
}
export interface PluginInjectImage {
  data: string;
  mimeType: string;
}
export type PluginEventName =
  | 'session_start'
  | 'session_end'
  | 'agent_start'
  | 'agent_end'
  | 'before_compact'
  | 'after_compact'
  | 'tool_call'
  | 'tool_result'
  | 'input'
  | 'context_usage'
  | 'session_status'
  | 'model_select'
  | 'before_agent_start';
export type PluginSessionState = 'idle' | 'running' | 'waiting' | 'error';
export interface PluginSessionStatus {
  sessionId: string;
  state: PluginSessionState;
  pendingAsks: number;
  pendingApprovals: number;
}
export interface PluginSessionInfo {
  id: string;
  title: string;
  updatedAt: number;
  state: PluginSessionState;
  running?: boolean;
  archived?: boolean;
  projectId?: string;
  projectName?: string;
}
export interface PluginStatusPatch {
  text?: string;
  tooltip?: string;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  visible?: boolean;
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
  artifacts?: string[];
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
  responseType?: 'text' | 'base64';
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
      ) => Awaitable<string | PluginToolResult>,
      meta?: {
        description: string;
        parameters: { type: 'object'; [key: string]: unknown };
        timeoutMs?: number;
      }
    ): Dispose | Promise<Dispose>;
  };
  readonly triggers: { register(name: string, handlers: TriggerHandlers): Dispose };
  readonly renderer: {
    handle(
      method: string,
      handler: (args: unknown, ctx: InvocationContext) => Awaitable<unknown>
    ): Dispose;
  };
  readonly commands: {
    register(
      id: string,
      handler: (ctx: InvocationContext) => Awaitable<unknown>,
      meta?: { title: string }
    ): Dispose | Promise<Dispose>;
  };
  readonly events: {
    on(
      event: PluginEventName,
      handler: (data: unknown, ctx: InvocationContext) => Awaitable<unknown>
    ): Dispose;
  };
  readonly schedules: {
    register(id: string, handler: (ctx: InvocationContext) => Awaitable<unknown>): Dispose;
  };
  readonly exports: {
    handle(
      name: string,
      handler: (args: unknown, ctx: InvocationContext) => Awaitable<unknown>
    ): Dispose;
  };
  readonly plugins: { call(pluginId: string, name: string, args?: unknown): Promise<unknown> };
  readonly artifacts: {
    write(
      input:
        | { name: string; text: string; mime?: string }
        | { name: string; base64: string; mime?: string }
    ): Promise<PluginArtifactInfo>;
  };
  readonly session: {
    messages(): Promise<unknown>;
    inject(input: {
      text: string;
      images?: PluginInjectImage[];
      sessionId?: string;
      deliverAs?: 'nextTurn' | 'steer' | 'followUp';
      triggerTurn?: boolean;
    }): Promise<null>;
    abort(sessionId?: string): Promise<null>;
    list(options?: {
      scope?: 'project' | 'all';
    }): Promise<{ current: string | null; sessions: PluginSessionInfo[] }>;
    status(sessionId?: string): Promise<PluginSessionStatus>;
    focus(sessionId: string): Promise<null>;
    focusSubagent(sessionId: string, agentId: string): Promise<null>;
    openChildRun(parentId: string, childId: string): Promise<null>;
    create(input?: { text?: string; presetId?: string }): Promise<{ sessionId: string }>;
  };
  readonly host: { capabilities(): Promise<PluginHostCapabilities> };
  readonly fs: {
    readText(path: string): Promise<string>;
    writeText(path: string, text: string): Promise<null>;
  };
  readonly net: { fetch(url: string, init?: PluginFetchInit): Promise<PluginFetchResult> };
  readonly ui: {
    notify(title: string, body?: string): Promise<null>;
    view: {
      emit(name: string, data?: unknown): Promise<null>;
      open(input?: string | { viewId?: string; sessionId?: string }): Promise<null>;
    };
    status: { update(id: string, patch: PluginStatusPatch): Promise<null> };
    clipboard: { writeText(text: string): Promise<null> };
    openExternal(url: string): Promise<null>;
  };
  readonly composer: ComposerApi;
  readonly config: { get(): Promise<Record<string, string | number | boolean>> };
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
  presetId?: string;
}
export type PluginSlot =
  | { slot: 'composer.left'; component: SlotComponent<ComposerSlotProps> }
  | { slot: 'composer.right'; component: SlotComponent<ComposerSlotProps> }
  | {
      slot: 'message.action';
      position: 'left' | 'right';
      component: SlotComponent<{
        position: 'left' | 'right';
        text: string;
        messageIndex?: number;
        sessionId?: string | null;
      }>;
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
    }
  | {
      slot: 'thinking.body';
      component: SlotComponent<{ text: string; streaming: boolean; itemKey: string }>;
    }
  | {
      slot: 'message.leaf';
      component: SlotComponent<{
        source: string;
        final: boolean;
        messageIndex: number;
        sessionId: string | null;
        Markdown: (props: { text: string }) => unknown;
      }>;
    };

export interface PluginRendererApi {
  readonly React: typeof import('react');
  readonly slots: { register(entry: PluginSlot): Dispose };
  dispatch(action: 'plugin.call', payload: { method: string; args?: unknown }): Promise<unknown>;
  /** Only present if the plugin has been granted composer.draft. */
  readonly composer?: ComposerApi;
  readonly theme: 'light' | 'dark';
  onTheme(listener: (theme: 'light' | 'dark') => void): Dispose;
}
// biome-ignore lint/suspicious/noConfusingVoidType: onLoad may omit a return, or return cleanup.
export type PluginOnLoad = (enso: PluginRendererApi) => Awaitable<void | Dispose>;

/** `window.enso` in a plugin's sandboxed sidebar HTML, not in its ui.js. */
export interface PluginViewApi {
  readonly theme: 'light' | 'dark';
  call(method: string, args?: unknown): Promise<unknown>;
  onTheme(listener: (theme: 'light' | 'dark') => void): Dispose;
  on(name: string, listener: (data: unknown) => void): Dispose;
  readonly file: {
    readonly rel: string;
    readonly text: string;
    onChange(listener: (file: { rel: string; text: string }) => void): Dispose;
    update(text: string): void;
  } | null;
  readonly storage: {
    get(key: string): string | null;
    set(key: string, value: string): void;
    remove(key: string): void;
  };
}
