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
  /** 可选：旧宿主不带该字段；桌面端明确给出内嵌浏览器桥是否可用 */
  browser?: boolean;
}
/** 内嵌浏览器支持的固定操作；不接受任意 CDP method、任意 JS 或截图 */
export type PluginBrowserOp =
  | 'navigate'
  | 'snapshot'
  | 'read'
  | 'click'
  | 'fill'
  | 'press_key'
  | 'inspect'
  | 'copy_selection'
  | 'insert_text'
  | 'read_range';
/**
 * navigate 用 { url, newTab? }；copy_selection 只接受 { tabId }；
 * insert_text 用 { tabId, text }（≤32KB UTF-8，只写给当前 activeElement，不 focus/选择/回车）
 */
export type PluginBrowserParams = Record<string, unknown>;
/** 复制选区里的零基表格范围；sheetId 来自元数据的 sheetStId */
export interface PluginCopySelectionRange {
  sheetId: string;
  rowFrom: number;
  rowTo: number;
  colFrom: number;
  colTo: number;
}
/** copy_selection 的结果：只投影 text 与可选的表格范围，超 64KB 直接报错 */
export interface PluginCopySelectionResult {
  text: string;
  range?: PluginCopySelectionRange;
}
export interface PluginInspectEntry {
  tag: string;
  text: string;
  /**
   * 表单标签（input/textarea/select）始终带该字段，空串与纯空格都原样返回；
   * 超过 8001 字符时截到 8001 并置 truncated，此时不要把该值写回页面。
   */
  value?: string;
  ref?: string;
  /** value 被截断时为 true；大于 8000 或 truncated 的值不应写回 */
  truncated?: boolean;
  rect: { x: number; y: number; width: number; height: number };
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
  /**
   * 操作当前本机会话里的内嵌浏览器；需 browser.control 权限与清单 browser.domains 白名单。
   * 域名、tab 归属与取消都由 Main 按权威记录复查。
   * copy_selection 只接受 { tabId }：先由插件选中范围并退出编辑态，宿主只发平台复制快捷键，
   * 只捕获同一次复制的 text/plain 与零基表格范围，不读取系统剪贴板。
   */
  readonly browser: {
    /** 仅本机 UI：固定读取金山范围，支持未启动 Agent 的新对话和 Plan，不提供单元格写入。 */
    invoke(
      op: 'read_range',
      params: { url: string; address: string; tabId?: string }
    ): Promise<PluginCopySelectionResult & { tabId: string; url: string; sheet: string }>;
    invoke(op: 'copy_selection', params: { tabId: string }): Promise<PluginCopySelectionResult>;
    invoke(op: PluginBrowserOp, params?: PluginBrowserParams): Promise<unknown>;
  };
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
