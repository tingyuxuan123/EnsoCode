/**
 * 设计子系统（移植自 Open Vetta vetta-ui-design）的跨层契约。
 *
 * 分层：Renderer 设计运行时（上游插件代码 + host 适配层）只传标识符与根内相对路径；
 * Main 按会话/项目权威记录推导绝对路径并校验边界；worker 只看到 vetd_* 代理工具。
 * 设计稿：docs/project-history/2026-11-02-vetta-ui-design-port-design.md
 */

// ─── 结果约定 ────────────────────────────────────────────────────────────────

export type DesignErrorCode =
  | 'INVALID_ARGUMENT'
  | 'PERMISSION_DENIED'
  | 'OUT_OF_ROOT'
  | 'NOT_FOUND'
  | 'ROOT_UNAVAILABLE'
  | 'TOO_LARGE'
  | 'TIMEOUT'
  | 'ABORTED'
  | 'ENGINE_UNAVAILABLE'
  | 'ENGINE_LIMIT'
  | 'NPM_UNAVAILABLE'
  | 'HOST_NOT_ALLOWED'
  | 'NO_RUNTIME'
  | 'FAILED';

export type DesignFailure = { ok: false; error: string; code: DesignErrorCode };
export type DesignResult<T extends object = Record<never, never>> =
  | ({ ok: true } & T)
  | DesignFailure;

// ─── 根与路径 ────────────────────────────────────────────────────────────────

/**
 * Renderer 能引用的根：会话运行 cwd 或项目根。绝对路径只由 Main 推导。
 * `rel` 一律是 POSIX 风格、相对根的路径；空串表示根本身。Main 拒绝 `..`、绝对路径、
 * 反斜杠、NUL 与符号链接逃逸。
 */
export type DesignRootRef =
  | { kind: 'session'; sessionId: string }
  | { kind: 'project'; projectId: string };

export interface DesignRootInfo {
  ref: DesignRootRef;
  /** 绝对路径，仅用于上游代码的路径拼接与展示；回传 Main 时必须换算成 rel。 */
  path: string;
}

// ─── 文件 ────────────────────────────────────────────────────────────────────

export type DesignFsEncoding = 'utf8' | 'base64';

export interface DesignFsEntry {
  name: string;
  rel: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number;
}

export type DesignFsRequest = { root: DesignRootRef } & (
  | { op: 'readDir'; rel: string }
  | { op: 'readFile'; rel: string }
  | { op: 'readBinaryFile'; rel: string }
  | { op: 'writeFile'; rel: string; content: string; encoding: DesignFsEncoding }
  | { op: 'stat'; rel: string }
  | { op: 'rename'; from: string; to: string }
  | { op: 'delete'; rel: string }
  | { op: 'createDirectory'; rel: string }
  | {
      op: 'listFilesRecursive';
      rel: string;
      names?: string[];
      ignoredDirectories?: string[];
    }
);

export type DesignFsResponse =
  | DesignResult<{ entries: DesignFsEntry[] }>
  | DesignResult<{ content: string; encoding: DesignFsEncoding }>
  | DesignResult<{ data: string; mimeType: string; size: number }>
  | DesignResult<{ stat: { size: number; modifiedAt: number; createdAt: number } | null }>
  | DesignResult<{ files: Array<{ name: string; rel: string }> }>
  | DesignResult;

export interface DesignSaveAsRequest {
  defaultFileName: string;
  content: string;
  encoding: DesignFsEncoding;
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}
/** 用户在原生对话框中选择的路径；取消时 path 为 null。 */
export type DesignSaveAsResponse = DesignResult<{ path: string | null }>;

// P3 gallery: only Main chooses the managed workspace. Archive is reversible
// gallery visibility, not removal of project execution authority.
export interface DesignProjectEntry {
  projectId: string;
  path: string;
}
export type DesignProjectsRequest =
  | { op: 'list' }
  | { op: 'create'; name: string }
  | { op: 'setArchived'; projectId: string; archived: boolean };
export type DesignProjectsResponse =
  | DesignResult<{
      workspacePath: string;
      projects: DesignProjectEntry[];
      archivedProjects: DesignProjectEntry[];
    }>
  | DesignResult<{ project: DesignProjectEntry }>
  | DesignResult;

export interface DesignOpenFilesRequest {
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  multiple?: boolean;
  maxBytes?: number;
}
export type DesignOpenFilesResponse = DesignResult<{
  files: Array<{ path: string; name: string; data: string }>;
}>;

/** Untrusted share HTML lives at a separate sandboxed origin, never in the host. */
export type DesignPreviewRequest =
  | { op: 'open'; html: string }
  | { op: 'close'; previewId: string };
export type DesignPreviewResponse = DesignResult<{ previewId: string; url: string }> | DesignResult;

export interface DesignWatchRequest {
  root: DesignRootRef;
  rel: string;
}
export type DesignWatchResponse = DesignResult<{ watchId: string }>;
/** 去抖后的目录变更通知；与上游一致，只说明哪个被监听目录有变化。 */
export interface DesignWatchEvent {
  watchId: string;
}

// ─── 引擎（vite dev server，Electron 自身以 ELECTRON_RUN_AS_NODE 运行） ─────────

export type DesignEngineRequest =
  | { op: 'start'; root: DesignRootRef; designRel: string }
  | { op: 'stop'; engineId: string }
  | { op: 'status'; engineId: string }
  | { op: 'build'; root: DesignRootRef; designRel: string; outRel: string }
  /** packages 缺省表示按设计包 package.json 安装；需要系统 npm。 */
  | { op: 'install'; root: DesignRootRef; designRel: string; packages?: string[] }
  | { op: 'diagnostics' };

export interface DesignEngineStatus {
  engineId: string;
  running: boolean;
  port: number;
  exit?: { exitCode: number | null; signal: string | null };
  /** stdout+stderr 环形缓冲尾巴，约 64KB。 */
  recentOutput: string;
}

export type DesignEngineResponse =
  | DesignResult<{ engineId: string; port: number; origin: string }>
  | DesignResult<{ status: DesignEngineStatus }>
  | DesignResult<{ output: string }>
  | DesignResult<{ engineVersion: string; engineRoot: string; npm: string | null }>
  | DesignResult;

export type DesignEnginePhase = 'materializing' | 'installing' | 'starting' | 'ready' | 'failed';

export interface DesignEngineProgressEvent {
  root: DesignRootRef;
  designRel: string;
  phase: DesignEnginePhase;
  outputTail?: string;
}

export interface DesignEngineExitEvent {
  engineId: string;
  exitCode: number | null;
  signal: string | null;
}

// ─── 离屏截图 ────────────────────────────────────────────────────────────────

export type DesignCaptureRequest =
  | {
      op: 'offscreen';
      /** 只能截已登记引擎的页面；Main 用自己记录的端口拼 URL。 */
      engineId: string;
      /** 以 `/` 开头的 path + query + hash。 */
      path: string;
      width: number;
      height: number;
      sessionKey?: string;
      prepareScript?: string;
      readyExpression?: string;
      settleMs?: number;
      probeScript?: string;
      timeoutMs?: number;
      format?: 'jpeg' | 'png';
      quality?: number;
    }
  | { op: 'release'; sessionKey: string };

export type DesignCaptureResponse =
  | DesignResult<{ dataUrl: string; scaleFactor: number; probe?: unknown }>
  | DesignResult;

// ─── 固定脚本（替代上游任意 `node -e`） ─────────────────────────────────────

export type DesignScriptRequest =
  /** 包内 .history 版本库，payload 即上游 runner 的 JSON 请求（不含 dir，dir 由 Main 推导）。 */
  | { script: 'history'; root: DesignRootRef; designRel: string; payload: Record<string, unknown> }
  /** 上游 vetd/check-syntax.ts 的语法扫描。 */
  | { script: 'check-syntax'; root: DesignRootRef; designRel: string; files: string[] };

export type DesignScriptResponse = DesignResult<{ result: unknown }>;

// ─── 私有存储（userData/design-data，跨项目） ────────────────────────────────

export type DesignStorageChange =
  | { type: 'write'; path: string; data: string; encoding: DesignFsEncoding }
  | { type: 'remove'; path: string };

export type DesignStorageRequest =
  | { op: 'list'; prefix?: string }
  | { op: 'readFile'; path: string; encoding: DesignFsEncoding }
  | { op: 'commit'; changes: DesignStorageChange[]; expectedRevision?: string }
  | { op: 'readSnapshot'; paths: string[]; encoding: DesignFsEncoding };

export type DesignStorageResponse =
  | DesignResult<{ paths: string[] }>
  | DesignResult<{ data: string | null }>
  | DesignResult<{ revision: string; changedPaths: string[] }>
  | DesignResult<{ revision: string; files: Record<string, string | null> }>;

// ─── 网络（Main 代发，固定主机白名单） ────────────────────────────────────────

export interface DesignNetworkRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: { type: 'json'; value: unknown };
  responseType?: 'json' | 'text' | 'base64';
  timeoutMs?: number;
}

export type DesignNetworkResponse = DesignResult<{
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
}>;

export type DesignShellRequest =
  | { op: 'showItemInFolder'; root: DesignRootRef; rel: string }
  | { op: 'openExternal'; url: string }
  /** Main derives the loopback origin from a live engine owned by the sender. */
  | { op: 'openEngineRoute'; engineId: string; path: string };

// ─── agent 工具：worker → Main → Renderer 设计运行时 ─────────────────────────

export const DESIGN_TOOL_NAMES = [
  'vetd_create',
  'vetd_screenshot',
  'vetd_status',
  'vetd_sizes',
  'vetd_install',
  'vetd_notes',
  'vetd_direction',
  'vetd_assets',
  'vetd_export',
  'vetd_history',
  'vetd_restore',
] as const;

export type DesignToolName = (typeof DESIGN_TOOL_NAMES)[number];

export function isDesignToolName(value: unknown): value is DesignToolName {
  return typeof value === 'string' && (DESIGN_TOOL_NAMES as readonly string[]).includes(value);
}

/** 计划模式下允许的只读工具；其余都会写文件或起进程。 */
export const DESIGN_PLAN_ALLOWED_TOOLS: readonly DesignToolName[] = [
  'vetd_status',
  'vetd_sizes',
  'vetd_history',
];

const LONG_TOOL_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_TOOL_TIMEOUT_MS = 2 * 60_000;

export function designToolTimeoutMs(tool: DesignToolName): number {
  return tool === 'vetd_install' ||
    tool === 'vetd_screenshot' ||
    tool === 'vetd_export' ||
    tool === 'vetd_create' ||
    tool === 'vetd_restore'
    ? LONG_TOOL_TIMEOUT_MS
    : DEFAULT_TOOL_TIMEOUT_MS;
}

export type DesignToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface DesignToolResult {
  content: DesignToolContent[];
  details?: unknown;
}

/** Main → Renderer：请运行时执行一次工具。cwd 由 Main 从会话权威记录推导。 */
export interface DesignToolRequestEvent {
  requestId: string;
  tool: DesignToolName;
  params: unknown;
  session: { sessionId: string; cwd: string; botChatId?: string };
}

export type DesignToolResponse =
  | { requestId: string; ok: true; result: DesignToolResult }
  | { requestId: string; ok: false; error: string };

export interface DesignToolCancelEvent {
  requestId: string;
}

/** 上游 registerHook 对应的会话事件：历史自动提交等。 */
export interface DesignHookEvent {
  event: 'prompt-submit' | 'stop' | 'session-end';
  sessionId: string;
  cwd: string;
  prompt?: string;
}

export interface DesignRuntimeRegistration {
  /** 该窗口当前正在看的会话，用于把工具调用路由到对的窗口。 */
  viewingSessionId: string | null;
}

/**
 * 画布挂载状态上报（P2）。上游 tool-gate 在「画布已打开」时直接开放全部 vetd_*；
 * Renderer 只报会话 id，cwd 由 Main 从会话权威记录推导后推给 worker。
 * 同一窗口的新上报整体替换旧上报；窗口销毁视为 open:false。
 */
export interface DesignCanvasPresence {
  sessionId: string | null;
  open: boolean;
}

/**
 * 独立设计窗口：把某个本地会话的画布弹到单独窗口，让多个项目同时使用画布。
 * 窗口绑定的会话由 Main 记录，Renderer 只能查询，不能自报。
 */
export type DesignWindowResult = { ok: true } | { ok: false; error: string };

export type DesignWindowInfo =
  | { ok: true; sessionId: string; streaming: boolean }
  | { ok: false; error: string };

/** 主窗口按会话投影算出的画布活动（与 vetta ConversationEvent 的两类工具事件同形）。 */
export type DesignWindowActivityEvent =
  | {
      type: 'tool-call-args';
      toolCallId: string;
      toolName: 'read' | 'edit' | 'write';
      args: { path: string };
    }
  | {
      type: 'tool-call-end';
      toolCallId: string;
      toolName: 'read' | 'edit' | 'write';
      isError: boolean;
    };

/** 主窗口 → Main → 独立设计窗口：运行状态与工具活动。 */
export interface DesignWindowState {
  sessionId: string;
  streaming: boolean;
  events: DesignWindowActivityEvent[];
}

/** 独立设计窗口发起的派活；会话由 Main 按窗口绑定补全。 */
export interface DesignWindowPromptInput {
  text: string;
  skipIfStreaming?: boolean;
}

export interface DesignWindowPromptRequest {
  requestId: string;
  sessionId: string;
  text: string;
  skipIfStreaming: boolean;
}

export interface DesignWindowPromptResult {
  status: 'sent' | 'queued' | 'failed';
  error?: string;
}

export type DesignWindowPromptResponse = DesignWindowPromptResult & { requestId: string };
