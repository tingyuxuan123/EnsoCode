import type { Locale } from '@shared/i18n';
import { isImageToolName } from '@shared/imageGeneration';
import { parseMcpToolName } from '@/lib/mcpToolName';
import type { TimelineItem } from '@/stores/sessions/timeline';

export type MusingTopic =
  | 'command'
  | 'commandRunning'
  | 'commandFailed'
  | 'read'
  | 'edit'
  | 'search'
  | 'folder'
  | 'web'
  | 'agent'
  | 'mcp'
  | 'browser'
  | 'image'
  | 'sandbox';

export interface MusingCue {
  topic: MusingTopic;
  name: string;
}

export const CUED_SHARE = 0.7;

export const MUSING_TIMING = {
  /** Caret appears briefly before the first glyph starts fading in. */
  leadMs: 60,
  /** Duration for each character to fade from 0 -> 1. */
  letterFadeMs: 70,
  /** Caret glide duration across each newly typed character. */
  caretGlideMs: 40,
  /** Resting caret blink period (ms). */
  caretBlinkMs: 500,
  /** Caret rests for 1.5 blinks after the last char finishes typing. */
  caretRestMs: 750,
  /** Interval between each of the 3 dots appearing. */
  dotStepMs: 400,
  /** Fade-in duration for each dot. */
  dotFadeMs: 140,
  /** Fade-out tail at the end of a 4-step dot round. */
  dotRoundFadeOutMs: 100,
  /** One round = 3 dot steps + 1 hold/clear step. */
  dotRoundMs: 1600,
  /** Number of dot rounds before rotating to the next rolling phrase. */
  dotRounds: 2,
  /** Whole-phrase fade-out before swapping to the next rolling phrase. */
  clearMs: 240,
} as const;

export interface CycleTimings {
  dotsAt: number;
  clearAt: number;
  cycleMs: number;
}

export interface MusingFrame {
  fade: number;
  letterOpacities: number[];
  dotOpacities: [number, number, number];
  showCaret: boolean;
  /** Index of the character the caret is gliding across; -1 during initial lead. */
  caretSegmentIndex: number;
  /** Eased [0..1] progress across `caretSegmentIndex`. */
  caretSegmentProgress: number;
  caretOpacity: number;
}

const MAX_COMMAND_LEN = 22;
const MAX_TARGET_LEN = 24;
const MAX_SEARCH_LEN = 20;

const CJK_GLYPH_RE = /[\u2e80-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
const SUBCOMMAND_RE = /^[a-z][a-z-]{1,11}$/;
const LINE_RANGE_RE = /:\d+(?:-\d+)?$/;
const URL_IN_TEXT_RE = /https?:\/\/[^\s"'<>]+/i;

const SHELL_TOOLS = new Set(['bash', 'powershell']);
const SEARCH_TOOLS = new Set(['grep', 'find', 'glob', 'code_search', 'tool_search']);
const SANDBOX_TOOLS = new Set(['exec', 'codemode', 'workflow']);

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function easeOutCubic(value: number): number {
  const inv = 1 - clamp01(value);
  return 1 - inv * inv * inv;
}

function shortLabel(text: string, maxLen = MAX_TARGET_LEN): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  const chars = Array.from(trimmed);
  if (chars.length <= maxLen) return trimmed;
  return `${chars.slice(0, maxLen - 1).join('')}…`;
}

function looksLikeJsonBlob(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

/** Strips trailing ASCII `...` or Unicode `…` from fixed labels before appending animated dots. */
export function stripTrailingEllipsis(text: string): string {
  return text.replace(/(?:\.{2,}|…)+\s*$/, '').trim();
}

/**
 * Extracts a concise `program [subcommand]` label from a shell command string,
 * skipping `cd` prefixes, inline env assignments, `sudo`, and trailing pipes.
 */
export function extractCommandLabel(command: string): string {
  const trimmed = command.trim();
  if (!trimmed || looksLikeJsonBlob(trimmed)) return '';
  const firstLine = trimmed.split('\n', 1)[0] ?? '';
  const chained = firstLine
    .split(/&&|\|\||;/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith('cd '));
  const lastCommand = chained.at(-1);
  if (!lastCommand) return '';
  const beforePipe = (lastCommand.split('|', 1)[0] ?? '').trim();
  const tokens = beforePipe.split(/\s+/).filter(Boolean);
  let cursor = 0;
  while (cursor < tokens.length && (tokens[cursor]!.includes('=') || tokens[cursor] === 'sudo')) {
    cursor += 1;
  }
  const rawProgram = tokens[cursor];
  if (!rawProgram) return '';
  const program = rawProgram.split(/[/\\]/).pop() ?? rawProgram;
  const sub = tokens[cursor + 1];
  const combined = sub && SUBCOMMAND_RE.test(sub) ? `${program} ${sub}` : program;
  return shortLabel(combined, MAX_COMMAND_LEN);
}

function extractTargetFileName(summary: string): string {
  const trimmed = summary.trim();
  if (!trimmed || looksLikeJsonBlob(trimmed)) return '';
  const withoutRange = trimmed.replace(LINE_RANGE_RE, '');
  const base = withoutRange.split(/[/\\]/).pop()?.trim() ?? '';
  if (!base || base === '.' || base === '..') return '';
  return shortLabel(base, MAX_TARGET_LEN);
}

function extractFolderName(summary: string): string {
  const trimmed = summary.trim().replace(/[/\\]+$/, '');
  if (!trimmed || trimmed === '.' || trimmed === '..' || looksLikeJsonBlob(trimmed)) return '';
  const base = trimmed.split(/[/\\]/).pop()?.trim() ?? '';
  if (!base || base === '.' || base === '..') return '';
  return shortLabel(base, MAX_TARGET_LEN);
}

function extractHost(summary: string): string {
  const trimmed = summary.trim();
  if (!trimmed || looksLikeJsonBlob(trimmed)) return '';
  const match = URL_IN_TEXT_RE.exec(trimmed);
  const candidate = match ? match[0] : trimmed;
  try {
    const url = new URL(candidate);
    const host = url.hostname.replace(/^www\./i, '');
    return shortLabel(host, MAX_TARGET_LEN);
  } catch {
    return '';
  }
}

function cueFromTool(item: Extract<TimelineItem, { kind: 'tool' }>): MusingCue | null {
  if (item.state === 'reviewing') return null;

  if (SHELL_TOOLS.has(item.name)) {
    const label = extractCommandLabel(item.summary);
    if (!label) return null;
    if (item.state === 'running') return { topic: 'commandRunning', name: label };
    return { topic: item.state === 'error' ? 'commandFailed' : 'command', name: label };
  }

  if (item.name === 'subagent') {
    if (item.state === 'error') return null;
    const label = looksLikeJsonBlob(item.summary) ? '' : shortLabel(item.summary, MAX_TARGET_LEN);
    return label ? { topic: 'agent', name: label } : null;
  }

  // Non-shell running tools usually finish quickly; wait until completion before musing on them.
  if (item.state !== 'ok') return null;

  if (item.name === 'read') {
    const name = extractTargetFileName(item.summary);
    return name ? { topic: 'read', name } : null;
  }

  if (item.name === 'edit' || item.name === 'write' || item.name === 'apply_patch') {
    const firstChanged = item.fileChanges?.[0]?.path;
    const name = extractTargetFileName(firstChanged ?? item.summary);
    return name ? { topic: 'edit', name } : null;
  }

  if (SEARCH_TOOLS.has(item.name)) {
    const query = looksLikeJsonBlob(item.summary) ? '' : shortLabel(item.summary, MAX_SEARCH_LEN);
    return query ? { topic: 'search', name: query } : null;
  }

  if (item.name === 'ls') {
    const folder = extractFolderName(item.summary);
    return folder ? { topic: 'folder', name: folder } : null;
  }

  if (item.name.startsWith('browser_') || item.browser) {
    return { topic: 'browser', name: '' };
  }

  if (item.name.includes('web') || item.name.includes('fetch')) {
    const host = extractHost(item.summary);
    if (host) return { topic: 'web', name: host };
    const query = looksLikeJsonBlob(item.summary) ? '' : shortLabel(item.summary, MAX_SEARCH_LEN);
    return query ? { topic: 'search', name: query } : null;
  }

  if (isImageToolName(item.name)) {
    return { topic: 'image', name: '' };
  }

  if (SANDBOX_TOOLS.has(item.name)) {
    return { topic: 'sandbox', name: '' };
  }

  const mcp = parseMcpToolName(item.name);
  if (mcp) {
    return { topic: 'mcp', name: shortLabel(mcp.tool, MAX_TARGET_LEN) };
  }

  return null;
}

/**
 * Derives a contextual musing cue from the most recent step in the active turn.
 * Stops at user messages and assistant text so cues never bleed from earlier turns.
 */
export function musingCueFor(items: readonly TimelineItem[]): MusingCue | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]!;
    if (item.kind === 'thinking') continue;
    if (item.kind === 'tool') return cueFromTool(item);
    if (item.kind === 'tool-group') {
      const nested = musingCueFor(item.children);
      if (nested) return nested;
      return null;
    }
    return null;
  }
  return null;
}

export function isCompactingTurn(items: readonly TimelineItem[]): boolean {
  return items.at(-1)?.kind === 'compaction-progress';
}

export function isReviewingTurn(items: readonly TimelineItem[]): boolean {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]!;
    if (item.kind === 'user') return false;
    if (item.kind === 'tool' && item.state === 'reviewing') return true;
    if (item.kind === 'tool-group' && isReviewingTurn(item.children)) return true;
  }
  return false;
}

const GENERAL_MUSINGS: Record<Locale, readonly string[]> = {
  zh: [
    '融会贯通',
    '抽丝剥茧',
    '理清脉络',
    '反复推敲',
    '慢火细熬',
    '酝酿方案',
    '串起线索',
    '权衡取舍',
    '仔细端详',
    '校准细节',
    '推演一番',
    '顺藤摸瓜',
    '打磨思路',
    '查漏补缺',
    '核对边界',
    '盘算下一步',
    '梳理上下文',
    '在脑海里试跑',
    '理顺调用链',
    '细看每一处改动',
    '对齐类型与约束',
    '琢磨更稳的做法',
    '把逻辑拼完整',
    '寻找最短路径',
  ],
  en: [
    'Connecting the threads',
    'Piecing it together',
    'Working through the details',
    'Weighing the trade-offs',
    'Mapping the path ahead',
    'Checking the edge cases',
    'Tracing the flow',
    'Refining the approach',
    'Untangling the logic',
    'Cross-checking context',
    'Shaping the next step',
    'Following a lead',
    'Dry-running the idea',
    'Tightening the plan',
    'Checking the reasoning',
    'Sorting out the pieces',
    'Aligning the constraints',
    'Looking a bit closer',
    'Distilling the signal',
    'Drafting a clean move',
  ],
};

export function generalMusings(locale?: Locale): readonly string[] {
  return locale === 'zh' ? GENERAL_MUSINGS.zh : GENERAL_MUSINGS.en;
}

export function cuedMusings(cue: MusingCue | null, locale?: Locale): readonly string[] {
  if (!cue) return [];
  const { topic, name } = cue;
  if (locale === 'zh') {
    switch (topic) {
      case 'command':
        return [
          `细读 ${name} 的输出`,
          `消化 ${name} 的运行结果`,
          `核对 ${name} 返回的细节`,
          `从 ${name} 的输出里找线索`,
        ];
      case 'commandRunning':
        return [`紧盯 ${name} 的执行进度`, `等待 ${name} 跑出结果`, `留意 ${name} 的实时输出`];
      case 'commandFailed':
        return [
          `顺着 ${name} 的报错溯源`,
          `定位 ${name} 失败的根因`,
          `拆解 ${name} 的异常信息`,
          `琢磨 ${name} 哪里卡住了`,
        ];
      case 'read':
        return [
          `细看 ${name} 的上下文`,
          `梳理 ${name} 的逻辑`,
          `在 ${name} 里寻线索`,
          `对照 ${name} 的实现`,
        ];
      case 'edit':
        return [
          `复核刚改的 ${name}`,
          `检查 ${name} 的改动影响`,
          `再扫一眼 ${name} 的细节`,
          `确认 ${name} 的边界情况`,
        ];
      case 'search':
        return [
          `筛选 ${name} 的命中线索`,
          `顺着 ${name} 的检索结果摸排`,
          `核对 ${name} 相关的引用`,
        ];
      case 'folder':
        return [`摸清 ${name} 的目录结构`, `盘点 ${name} 里的文件`];
      case 'web':
        return [`整理来自 ${name} 的资料`, `提炼 ${name} 上的关键信息`];
      case 'agent':
        return [`汇合 ${name} 的进展`, `核对 ${name} 带回的结论`];
      case 'mcp':
        return [`解析 ${name} 的返回结果`, `整理 ${name} 提供的信息`];
      case 'browser':
        return ['端详页面的最新状态', '核对浏览器里的画面'];
      case 'image':
        return ['端详刚生成的画面', '审视新图的细节'];
      case 'sandbox':
        return ['对照脚本跑出的结果', '汇总工具编排的输出'];
    }
  }

  switch (topic) {
    case 'command':
      return [
        `Reviewing ${name} output`,
        `Digesting results from ${name}`,
        `Checking what ${name} reported`,
      ];
    case 'commandRunning':
      return [`Waiting on ${name}`, `Watching ${name} run`, `Tracking ${name} output`];
    case 'commandFailed':
      return [
        `Tracing the ${name} failure`,
        `Diagnosing why ${name} failed`,
        `Unpacking the ${name} error`,
      ];
    case 'read':
      return [`Studying ${name}`, `Tracing logic in ${name}`, `Absorbing ${name}`];
    case 'edit':
      return [
        `Reviewing edits to ${name}`,
        `Double-checking ${name}`,
        `Verifying changes in ${name}`,
      ];
    case 'search':
      return [`Sifting through matches for ${name}`, `Following leads on ${name}`];
    case 'folder':
      return [`Surveying ${name}`, `Mapping out ${name}`];
    case 'web':
      return [`Distilling notes from ${name}`, `Reviewing docs from ${name}`];
    case 'agent':
      return [`Reviewing report from ${name}`, `Syncing with ${name}`];
    case 'mcp':
      return [`Unpacking response from ${name}`, `Reading output from ${name}`];
    case 'browser':
      return ['Inspecting the live page', 'Checking the browser state'];
    case 'image':
      return ['Inspecting the generated image', 'Reviewing the visual output'];
    case 'sandbox':
      return ['Reviewing orchestrated results', 'Checking the script output'];
  }
}

export function pickNextPhrase({
  general,
  cued = [],
  avoid,
  random = Math.random,
}: {
  general: readonly string[];
  cued?: readonly string[];
  avoid?: string;
  random?: () => number;
}): string {
  const pool = cued.length > 0 && random() < CUED_SHARE ? cued : general;
  if (pool.length === 0) return '';
  const avoidIdx = avoid ? pool.indexOf(avoid) : -1;
  if (avoidIdx < 0 || pool.length < 2) {
    return pool[Math.floor(random() * pool.length) % pool.length]!;
  }
  const pick = Math.floor(random() * (pool.length - 1)) % (pool.length - 1);
  return pool[pick < avoidIdx ? pick : pick + 1]!;
}

/** Builds per-glyph typing timestamps (ms) with slightly slower cadence for wide CJK glyphs. */
export function buildTypeSchedule(
  chars: readonly string[],
  random: () => number = Math.random
): number[] {
  const schedule: number[] = [];
  let at: number = MUSING_TIMING.leadMs;
  for (const char of chars) {
    schedule.push(at);
    if (CJK_GLYPH_RE.test(char)) {
      at += 32 + Math.floor(random() * 20);
    } else {
      at += 14 + Math.floor(random() * 16) + (char === ' ' ? 24 : 0);
    }
  }
  return schedule;
}

export function computeCycleTimings(typedAt: readonly number[], rolls: boolean): CycleTimings {
  const typing = typedAt.length > 0;
  const dotsAt = typing
    ? typedAt[typedAt.length - 1]! + MUSING_TIMING.caretGlideMs + MUSING_TIMING.caretRestMs
    : 0;
  const clearAt = dotsAt + MUSING_TIMING.dotRoundMs * MUSING_TIMING.dotRounds;
  const cycleMs = clearAt + (rolls ? MUSING_TIMING.clearMs : 0);
  return { dotsAt, clearAt, cycleMs };
}

/** Evaluates opacities and caret kinematics at elapsed `t` ms into the current phrase cycle. */
export function evaluateMusingFrame(
  t: number,
  typedAt: readonly number[],
  rolls: boolean,
  charCount = typedAt.length
): MusingFrame {
  const { dotsAt, clearAt } = computeCycleTimings(typedAt, rolls);
  const typing = typedAt.length > 0;
  const fade = rolls ? 1 - clamp01((t - clearAt) / MUSING_TIMING.clearMs) : 1;

  const letterOpacities = new Array<number>(charCount);
  for (let i = 0; i < charCount; i += 1) {
    const letter = typing ? clamp01((t - typedAt[i]!) / MUSING_TIMING.letterFadeMs) : 1;
    letterOpacities[i] = fade * letter;
  }

  const dotOpacities: [number, number, number] = [0, 0, 0];
  const roundElapsed = t - dotsAt;
  if (roundElapsed >= 0 && roundElapsed < MUSING_TIMING.dotRoundMs * MUSING_TIMING.dotRounds) {
    const inRound = roundElapsed % MUSING_TIMING.dotRoundMs;
    const roundFadeOut = clamp01(
      (MUSING_TIMING.dotRoundMs - inRound) / MUSING_TIMING.dotRoundFadeOutMs
    );
    for (let k = 0; k < 3; k += 1) {
      const dotIn = clamp01(
        (inRound - (k + 1) * MUSING_TIMING.dotStepMs) / MUSING_TIMING.dotFadeMs
      );
      dotOpacities[k] = fade * dotIn * roundFadeOut;
    }
  }

  const showCaret = typing && t < dotsAt;
  let caretSegmentIndex = -1;
  let caretSegmentProgress = 0;
  let caretOpacity = 0;

  if (showCaret) {
    for (let i = typedAt.length - 1; i >= 0; i -= 1) {
      if (typedAt[i]! <= t) {
        caretSegmentIndex = i;
        break;
      }
    }
    if (caretSegmentIndex >= 0) {
      caretSegmentProgress = easeOutCubic(
        (t - typedAt[caretSegmentIndex]!) / MUSING_TIMING.caretGlideMs
      );
    }
    const leadFade = clamp01(t / 80);
    const tailFade = clamp01((dotsAt - t) / 80);
    const resting = t - (dotsAt - MUSING_TIMING.caretRestMs);
    if (resting < 0) {
      caretOpacity = leadFade * tailFade;
    } else {
      const blink = resting % MUSING_TIMING.caretBlinkMs;
      const halfBlink = MUSING_TIMING.caretBlinkMs / 2;
      const pulse =
        blink < halfBlink
          ? clamp01((halfBlink - blink) / 60)
          : clamp01((blink - (MUSING_TIMING.caretBlinkMs - 60)) / 60);
      caretOpacity = leadFade * tailFade * pulse;
    }
  }

  return {
    fade,
    letterOpacities,
    dotOpacities,
    showCaret,
    caretSegmentIndex,
    caretSegmentProgress,
    caretOpacity,
  };
}
