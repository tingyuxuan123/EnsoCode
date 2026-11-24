/**
 * 线协议类型：手机 ↔ Electron 经中继交换的帧。
 * pair 包自包含，不反向依赖应用源码；与 @shared/types/agent 的枚举取值保持一致，
 * main 侧解密后按结构校验再交给现有 sendCommand / IPC。
 */

// 与 @shared/types/agent 对齐的最小重定义（保持字面量一致以便结构兼容）
export interface AttachedImage {
  data: string;
  mimeType: string;
}
export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ApprovalMode = 'supervised' | 'auto-edits' | 'full' | 'assistant';
export type ApprovalDecision = 'allow' | 'allowSession' | 'deny';

// ── 中继明文控制帧（中继可见，不加密）──────────────────────────────────
export type PairControl =
  | { type: 'host-online' }
  | { type: 'host-offline' }
  | { type: 'peer-joined' }
  | { type: 'peer-left' }
  /** 配对已被任一端解除：收到即清本地凭据、停止重连，不可与网络断开混淆 */
  | { type: 'revoked' };

/**
 * Web Push 订阅（PushSubscription.toJSON() 的结构子集）。
 * 手机经加密信道交给桌面，桌面 main 用 web-push 直发，中继不参与。
 */
export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// ── 直连（WebRTC DataChannel）信令：经中继 E2E 帧交换，中继不感知 ──────────────

/** host 声明的直连能力；guest 只在看到它时才发起 offer，旧桌面永不声明、旧 PWA 忽略字段 */
export type DirectCapability = 'direct-v1';

export interface IceServerEntry {
  urls: string[];
}

export interface DirectCandidate {
  candidate: string;
  sdpMid: string | null;
}

/** 信令帧单字段上限：SDP 通常 < 4KB，候选 < 300B；超出即非法 */
export const DIRECT_SIGNAL_MAX_CHARS = 16_384;

export type PairSyncCursor = { epoch: string; seq: number };

/** Opaque Main-derived identity; rel is display-only, never accepted in file requests. */
export type PairFileTarget = { sessionId: string };
export interface PairPreviewEntry {
  id: string;
  label: string;
  kind: 'html' | 'server';
}
export interface PairPreviewFrame {
  frameId: string;
  width: number;
  height: number;
  dataUrl: string;
  title?: string;
}
export type PairPreviewInput =
  | { kind: 'click'; x: number; y: number }
  | { kind: 'scroll'; deltaX: number; deltaY: number }
  | { kind: 'text'; text: string }
  | {
      kind: 'key';
      key:
        | 'Enter'
        | 'Tab'
        | 'Escape'
        | 'Backspace'
        | 'ArrowUp'
        | 'ArrowDown'
        | 'ArrowLeft'
        | 'ArrowRight';
    };
export interface PairFileEntry {
  id: string;
  name: string;
  size: number;
  rel: string;
}
export const PAIR_FILE_CHUNK_BYTES = 384 * 1024;
export const PAIR_FILE_MAX_BYTES = 50 * 1024 * 1024;

export type PairSessionSync = {
  type: 'session-sync';
  sessionId: string;
  requestId: string;
  cursor: PairSyncCursor;
} & (
  | { mode: 'snapshot'; snapshot: unknown }
  | { mode: 'replay'; fromSeq: number; events: unknown[] }
);

// ── 上行：手机 → Electron（加密 payload，白名单）─────────────────────────
export type PhoneToHost =
  | { type: 'replay-hello' }
  | { type: 'preview-list'; requestId: string; target: PairFileTarget }
  | {
      type: 'preview-open';
      requestId: string;
      target: PairFileTarget;
      entryId: string;
      width: number;
      height: number;
    }
  | {
      type: 'preview-frame' | 'preview-refresh' | 'preview-close';
      requestId: string;
      previewId: string;
    }
  | {
      type: 'preview-input';
      requestId: string;
      previewId: string;
      frameId: string;
      input: PairPreviewInput;
    }
  /**
   * 会话里的图片（read/生成的图片文件）：工作区图片只报相对路径；目录外 read 图片
   * 只报时间线里的工具调用 id，由 host 从权威会话记录反查原始路径。
   */
  | (
      | { type: 'session-image'; requestId: string; sessionId: string; rel: string }
      | { type: 'session-image'; requestId: string; sessionId: string; toolCallId: string }
    )
  | { type: 'file-list'; requestId: string; target: PairFileTarget }
  | { type: 'file-read'; requestId: string; target: PairFileTarget; fileId: string; offset: number }
  | { type: 'prompt'; sessionId: string; text: string; images?: AttachedImage[] }
  | { type: 'steer'; sessionId: string; text: string; images?: AttachedImage[] }
  | { type: 'abort'; sessionId: string }
  | { type: 'approval-respond'; sessionId: string; requestId: string; decision: ApprovalDecision }
  | { type: 'ask-respond'; sessionId: string; requestId: string; answer: string }
  | { type: 'snapshot' }
  | {
      type: 'subscribe';
      sessionId: string | null;
      sinceIndex?: number;
      sync?: { requestId: string; cursor?: PairSyncCursor };
    }
  | {
      type: 'spawn';
      sessionId: string;
      projectId: string;
      providerId: string;
      modelId: string;
      presetId?: string;
      approvalMode?: ApprovalMode;
      reasoningEnabled?: boolean;
      thinkingLevel?: ThinkingLevel;
    }
  /** 与桌面 setModel 同语义：记忆会话选用模型，运行中的会话下次 spawn 生效 */
  | { type: 'set-model'; sessionId: string; providerId: string; modelId: string }
  | { type: 'set-reasoning'; sessionId: string; enabled: boolean }
  | { type: 'set-thinking'; sessionId: string; level: ThinkingLevel }
  /** 上滑分页：拉取 beforeIndex 之前的一页历史消息 */
  | { type: 'history'; sessionId: string; beforeIndex: number }
  /** 排队：轮次进行中发消息，与桌面同语义入队（不打断当前轮） */
  | { type: 'enqueue'; sessionId: string; text: string; images?: AttachedImage[] }
  | { type: 'queue-remove'; sessionId: string; messageId: string }
  | { type: 'queue-update'; sessionId: string; messageId: string; text: string }
  | { type: 'queue-send-now'; sessionId: string; messageId: string }
  | { type: 'queue-interrupt-send'; sessionId: string; messageId: string }
  | { type: 'goal-pause'; sessionId: string }
  | { type: 'goal-resume'; sessionId: string }
  | { type: 'goal-clear'; sessionId: string }
  | { type: 'goal-set'; sessionId: string; text: string }
  | { type: 'compact'; sessionId: string; instructions?: string }
  | { type: 'rewind'; sessionId: string; userIndexFromEnd: number; restoreFiles?: boolean }
  | { type: 'retry'; sessionId: string }
  | { type: 'task-stop'; sessionId: string; taskId: string }
  | { type: 'subagent-stop'; sessionId: string; agentId: string }
  /** 登记/解除 Web Push 订阅：手机离线时桌面用它发系统推送 */
  | { type: 'push-subscribe'; subscription: PushSubscriptionJson }
  | { type: 'push-unsubscribe' }
  /**
   * 可见性上报：iOS 锁屏/切后台时 socket 只是半开不会 close，桌面无法靠
   * peer-left 判断手机是否还在看。退后台瞬间主动发一帧，推送据此门控。
   */
  | { type: 'presence'; visible: boolean }
  /** 直连协商：guest 发起，`gen` 每轮递增，不等于当前代的信令一律丢弃 */
  | { type: 'direct-offer'; gen: number; sdp: string }
  | ({ type: 'direct-ice'; gen: number } & DirectCandidate)
  /** guest 放弃本代（超时/网络变化），host 释放对应 PeerConnection */
  | { type: 'direct-close'; gen: number }
  /** 经中继的端到端测速；必须走中继，不能走直连 */
  | { type: 'probe'; nonce: number }
  /**
   * 语音转写上传：data 为 16kHz 单声道小端 Int16 PCM 的 base64url。
   * 直连/中继回退可能乱序，host 按 index 拼，last 标出末块。
   * 录音中约 200ms 发一块，host 边收边识别并回推 voice-partial。
   */
  | { type: 'voice-chunk'; requestId: string; index: number; data: string; last?: true }
  /** 放弃录音：host 丢弃该 requestId 的识别会话，不再回 voice-result */
  | { type: 'voice-cancel'; requestId: string };

/** 手机命令白名单：main 只接受这些 type，其余（set-approval-mode、设置写入等）拒绝 */
export const PHONE_COMMAND_TYPES = [
  'preview-list',
  'preview-open',
  'preview-frame',
  'preview-refresh',
  'preview-close',
  'preview-input',
  'file-list',
  'file-read',
  'session-image',
  'prompt',
  'steer',
  'abort',
  'approval-respond',
  'ask-respond',
  'snapshot',
  'subscribe',
  'spawn',
  'set-model',
  'set-reasoning',
  'set-thinking',
  'history',
  'enqueue',
  'queue-remove',
  'queue-update',
  'queue-send-now',
  'queue-interrupt-send',
  'goal-pause',
  'goal-resume',
  'goal-clear',
  'goal-set',
  'compact',
  'rewind',
  'retry',
  'task-stop',
  'subagent-stop',
  'push-subscribe',
  'push-unsubscribe',
  'presence',
  'direct-offer',
  'direct-ice',
  'direct-close',
  'probe',
  'voice-chunk',
  'voice-cancel',
] as const satisfies readonly PhoneToHost['type'][];

export function isPhoneCommand(value: unknown): value is PhoneToHost {
  return (
    typeof value === 'object' &&
    value !== null &&
    (PHONE_COMMAND_TYPES as readonly string[]).includes(
      (value as { type?: unknown }).type as string
    )
  );
}

// ── 下行：Electron → 手机（加密 payload）────────────────────────────────
export interface CatalogEntry {
  id: string;
  title: string;
  projectName: string;
  projectId: string;
  /** 工具实际执行目录（worktree 优先，回落项目路径）：手机把项目内绝对路径收成相对路径 */
  cwd?: string;
  status: string;
  /** 完成后未查看：桌面绿点、手机灰点 */
  unread?: boolean;
  /** 挂起的 ask_user 数：抽屉「活跃中」与桌面 waiting 色点同口径 */
  pendingAskCount?: number;
  /** 挂起的工具审批数：手机主屏幕角标与待审批入口 */
  pendingApprovalCount?: number;
  parentId?: string;
  /** 最后活动时间（末条消息或创建时间），手机端显示相对时间 */
  updatedAt?: number;
  /** 置顶/归档（与桌面侧栏同语义：归档与置顶互斥，归档只进单独栏目） */
  pinned?: boolean;
  archived?: boolean;
  /** 静音：手机/PWA 不再为这个会话发推送，主屏幕角标也不计入 */
  muted?: boolean;
  /** 会话当前选用的 provider/model 与推理档位，手机模型切换器回显用 */
  providerId?: string;
  modelId?: string;
  reasoningEnabled?: boolean;
  thinkingLevel?: ThinkingLevel;
  /** 排队中的消息（桌面 renderer 独有状态），手机队列区展示与操作用 */
  queued?: { id: string; text: string; hasImages?: boolean }[];
  /** 会话目标（桌面 renderer 独有状态），手机 GoalBar 展示与操作用 */
  goal?: {
    text: string;
    status: 'active' | 'paused' | 'completed' | 'blocked' | 'waiting';
    note?: string;
    autoTurns: number;
  };
  /** 斜杠命令（技能名），仅当前订阅会话下发 */
  slashCommands?: { name: string; description: string }[];
  /** 状态栏上下文占用（桌面 session-meta 投影），仅当前订阅会话下发 */
  context?: { used: number; window?: number };
  /** 状态栏 token/缓存/速度（worker 按完整记录算，手机尾窗算不全），仅当前订阅会话下发 */
  usageTotals?: {
    inputTokens: number;
    outputTokens: number;
    cacheHitPercent?: number;
    ttftAvgMs?: number;
    tokensPerSecond?: number;
  };
}
export interface ProjectEntry {
  id: string;
  name: string;
  path: string;
  /** 用户设置的项目别名；展示一律走 pairProjectDisplayName，name 保持真实项目名 */
  alias?: string;
  kind?: 'local' | 'ssh';
  sshConnectionName?: string;
  sshHost?: string;
  /** 桌面侧栏已归档该项目：其全部会话归到手机归档栏，会话自身 archived 标记不动 */
  archived?: true;
  /** 所属项目组；缺省或未知 id = 未分组 */
  groupId?: string;
}

/** 桌面扁平项目组，随 projects 帧下发 */
export interface ProjectGroupEntry {
  id: string;
  name: string;
  emoji?: string;
  color?: string;
  order: number;
}
/** provider 剥密后下发，只够手机做 provider/model 选择 */
export interface ProviderEntry {
  id: string;
  name: string;
  models: { id: string; label?: string }[];
}

/**
 * 桌面下发的外观偏好，手机作为默认值（可本地覆盖）。
 * sync-terminal 表示整套 UI 配色由终端主题推导（与桌面同语义），
 * 此时须配合 terminal 调色板使用。
 */
export type HostAppearance = 'light' | 'dark' | 'system' | 'sync-terminal';

/**
 * 终端配色（bash 工具输出用）。只下发桌面当前选中主题解析后的调色板，
 * 手机不必打包整份 ghostty 主题库。字段与 renderer 的 XtermTheme 一致。
 */
export interface TerminalPalette {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

/** 下行信封：pair 自有的目录类帧 + 透传的现有 RendererAgentEvent（此处不重定义，按 unknown 透传） */
export type HostToPhone =
  | { type: 'replay-hello' }
  | { type: 'preview-list-result'; requestId: string; entries: PairPreviewEntry[]; error?: string }
  | {
      type: 'preview-result';
      requestId: string;
      previewId?: string;
      frame?: PairPreviewFrame;
      error?: string;
    }
  | {
      type: 'catalog';
      entries: CatalogEntry[];
      /** 桌面置顶组的手动拖拽顺序；缺省（旧桌面）时手机按活跃倒序 */
      pinnedOrder?: string[];
    }
  | { type: 'projects'; projects: ProjectEntry[]; groups?: ProjectGroupEntry[] }
  | { type: 'providers'; providers: ProviderEntry[] }
  | {
      type: 'appearance';
      theme: HostAppearance;
      /** 桌面选中的终端配色；缺省表示用手机默认 */
      terminal?: TerminalPalette;
      terminalFontFamily?: string;
      /** 桌面「精简只读工具调用」偏好；缺省（旧桌面）时手机按默认开处理 */
      compactReadOnlyTools?: boolean;
      /** 桌面「运行中自动展开文件改动」偏好；缺省（旧桌面）时手机按默认开处理 */
      expandLiveEdits?: boolean;
      /** 桌面时间线折叠 / 待办条偏好；缺省（旧桌面）时手机按桌面默认值 */
      expandLiveReasoning?: boolean;
      autoCollapseTurns?: boolean;
      collapseCompletedActivity?: boolean;
      pinUnfinishedTodos?: boolean;
    }
  | { type: 'agent-event'; event: unknown; cursor?: PairSyncCursor }
  | PairSessionSync
  /** Web Push 能力下发：手机拿 VAPID 公钥才能 pushManager.subscribe */
  | { type: 'push-config'; vapidPublicKey: string }
  /** history 命令的应答：baseIndex 之前拼接的一页消息，手机按绝对 index 合并 */
  | { type: 'history'; sessionId: string; baseIndex: number; messages: unknown[] }
  /**
   * host 自述：guest（另一台桌面）用 hostname 作默认节点名。
   * 旧版 PWA 的 switch 无 default 分支，未知帧直接忽略，因此可安全新增。
   */
  | {
      type: 'host-info';
      hostname: string;
      appVersion: string;
      /** Missing on older desktops: file download UI must stay hidden. */
      files?: true;
      /** 会话图片预览（read / 生成图片）：缺省（旧桌面）时手机不请求，保持纯文本回退 */
      images?: true;
      preview?: true;
      /** 直连能力声明；缺省（旧桌面）即不支持 */
      capabilities?: DirectCapability[];
      /** STUN 列表由 host 下发，guest 不硬编码，换地址只改桌面 */
      iceServers?: IceServerEntry[];
      /** 桌面语音识别可用（设置开启且模型就绪） */
      voiceInput?: true;
      /** 本设备被桌面设为只读：手机隐藏发送/审批等写操作（host 侧另有强制拦截） */
      readOnly?: true;
    }
  | { type: 'direct-answer'; gen: number; sdp: string }
  | ({ type: 'direct-ice'; gen: number } & DirectCandidate)
  | { type: 'probe-ack'; nonce: number }
  /** 识别中间结果（整句覆盖，不是增量）；correcting = 已定稿、正在纠错 */
  | { type: 'voice-partial'; requestId: string; text: string; correcting?: true }
  /** voice-chunk 的应答；error 为 SpeechErrorCode，未知值按 failed 处理 */
  | { type: 'voice-result'; requestId: string; text?: string; error?: string }
  /** 只读设备的写命令被 host 拦截；旧手机忽略 */
  | { type: 'command-rejected'; command: string; error: 'read-only' }
  /** session-image 的应答：dataUrl 已压到手机单帧预算内；error 见 host 侧错误码 */
  | { type: 'session-image-result'; requestId: string; dataUrl?: string; error?: string }
  | { type: 'file-list-result'; requestId: string; files: PairFileEntry[]; error?: string }
  | {
      type: 'file-read-result';
      requestId: string;
      name?: string;
      size?: number;
      offset?: number;
      /** Standard base64 of at most PAIR_FILE_CHUNK_BYTES raw bytes. */
      data?: string;
      error?: string;
    };
