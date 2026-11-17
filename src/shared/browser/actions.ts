import { parseBrowserKey } from './interactionScripts';
import { renderSnapshot, type SnapshotEntry } from './snapshot';
import { assertAllowedUrl } from './urlPolicy';

export const BROWSER_ACTIONS = [
  'click',
  'type',
  'fill',
  'press',
  'scroll',
  'select',
  'hover',
  'check',
  'wait',
  'navigate',
] as const;
export const BROWSER_ACTION_MAX_STEPS = 10;
export const BROWSER_ACTION_BUDGET_MS = 45_000;
export interface ActionTarget {
  ref?: string;
  target?: string;
  role?: string;
  nth?: number;
}
export interface BrowserAction extends ActionTarget {
  action: (typeof BROWSER_ACTIONS)[number];
  text?: string;
  submit?: boolean;
  key?: string;
  direction?: string;
  amount?: number;
  values?: string[];
  checked?: boolean;
  timeoutMs?: number;
  url?: string;
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const targetKeys = ['ref', 'target', 'role', 'nth'];
const fields: Record<BrowserAction['action'], string[]> = {
  click: targetKeys,
  hover: targetKeys,
  type: [...targetKeys, 'text', 'submit'],
  fill: [...targetKeys, 'text'],
  press: ['key'],
  scroll: [...targetKeys, 'direction', 'amount'],
  select: [...targetKeys, 'values'],
  check: [...targetKeys, 'checked'],
  wait: ['text', 'timeoutMs'],
  navigate: ['url'],
};

/** Model schema adapters may require all optional fields. Drop only fields unused by the chosen action. */
export function normalizeBrowserActionSteps(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw;
  return raw.map((step) => {
    if (!record(step) || !BROWSER_ACTIONS.includes(step.action as BrowserAction['action']))
      return step;
    const allowed = fields[step.action as BrowserAction['action']];
    const out: Record<string, unknown> = Object.fromEntries(
      Object.entries(step).filter(([key]) => key === 'action' || allowed.includes(key))
    );
    for (const key of ['ref', 'target', 'role'])
      if (typeof out[key] === 'string' && !out[key].trim()) delete out[key];
    if (!out.target) {
      delete out.role;
      delete out.nth;
    }
    return out;
  });
}

/** Validate the whole batch, not lazily after earlier side effects. Main repeats this check. */
export function parseBrowserActions(raw: unknown): BrowserAction[] {
  if (
    !record(raw) ||
    Object.keys(raw).some((k) => !['steps', 'tabId'].includes(k)) ||
    !Array.isArray(raw.steps) ||
    raw.steps.length < 1 ||
    raw.steps.length > BROWSER_ACTION_MAX_STEPS
  )
    throw new Error(`browser_act requires 1–${BROWSER_ACTION_MAX_STEPS} steps`);
  let chars = 0;
  return raw.steps.map((step, index) => {
    const bad = () => new Error(`Invalid browser_act step ${index + 1}`);
    if (!record(step) || !BROWSER_ACTIONS.includes(step.action as BrowserAction['action']))
      throw bad();
    const action = step.action as BrowserAction['action'];
    if (Object.keys(step).some((key) => key !== 'action' && !fields[action].includes(key)))
      throw bad();
    for (const key of ['ref', 'target', 'role', 'text', 'key', 'url']) {
      const value = step[key];
      if (
        value !== undefined &&
        (typeof value !== 'string' || value.length > (key === 'text' ? 32000 : 2000))
      )
        throw bad();
      if (typeof value === 'string') chars += value.length;
    }
    if (chars > 64000) throw new Error('browser_act text budget exceeded');
    if (targetKeys.some((key) => step[key] !== undefined)) {
      if (Boolean(step.ref) === Boolean(step.target)) throw bad();
      if (step.ref !== undefined && (typeof step.ref !== 'string' || !step.ref.trim())) throw bad();
      if (step.target !== undefined && (typeof step.target !== 'string' || !step.target.trim()))
        throw bad();
      if ((step.role !== undefined || step.nth !== undefined) && !step.target) throw bad();
    } else if (['click', 'type', 'fill', 'select', 'hover', 'check'].includes(action)) throw bad();
    if (
      step.nth !== undefined &&
      (!Number.isSafeInteger(step.nth) || Number(step.nth) < 1 || Number(step.nth) > 400)
    )
      throw bad();
    if (['type', 'fill', 'wait'].includes(action) && typeof step.text !== 'string') throw bad();
    if (action === 'wait' && !String(step.text).trim()) throw bad();
    if (step.submit !== undefined && typeof step.submit !== 'boolean') throw bad();
    if (action === 'check' && typeof step.checked !== 'boolean') throw bad();
    if (action === 'press') {
      if (typeof step.key !== 'string' || !step.key.trim()) throw bad();
      parseBrowserKey(step.key);
    }
    if (action === 'navigate') {
      if (typeof step.url !== 'string') throw bad();
      assertAllowedUrl(step.url);
    }
    if (
      step.direction !== undefined &&
      !['up', 'down', 'left', 'right'].includes(String(step.direction))
    )
      throw bad();
    if (
      step.amount !== undefined &&
      (typeof step.amount !== 'number' ||
        !Number.isSafeInteger(step.amount) ||
        step.amount < 1 ||
        step.amount > 5000)
    )
      throw bad();
    if (
      step.timeoutMs !== undefined &&
      (typeof step.timeoutMs !== 'number' ||
        !Number.isSafeInteger(step.timeoutMs) ||
        step.timeoutMs < 1 ||
        step.timeoutMs > 10000)
    )
      throw bad();
    if (
      action === 'select' &&
      (!Array.isArray(step.values) ||
        step.values.length < 1 ||
        step.values.length > 50 ||
        step.values.some((v) => typeof v !== 'string' || v.length > 2000))
    )
      throw bad();
    return { ...step } as unknown as BrowserAction;
  });
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();
export function findActionTarget(
  entries: readonly SnapshotEntry[],
  target: ActionTarget
): string | undefined {
  if (target.ref) return target.ref;
  const text = normalize(target.target ?? '');
  const candidates = entries.filter(
    (e) => e.ref && (!target.role || normalize(e.role) === normalize(target.role))
  );
  const exact = candidates.filter((e) => normalize(e.name) === text);
  const matches = exact.length ? exact : candidates.filter((e) => normalize(e.name).includes(text));
  if (target.nth) return matches[target.nth - 1]?.ref;
  if (matches.length > 1)
    throw new Error(
      `Ambiguous target ${JSON.stringify(target.target)}: ${matches.length} matches; specify role or nth`
    );
  return matches[0]?.ref;
}

/** Bounded feedback; only refs actually printed here become newly usable. */
export function actionChanges(
  before: readonly SnapshotEntry[] | undefined,
  after: readonly SnapshotEntry[]
): { text: string; refs: string[] } {
  const lines: string[] = [],
    refs: string[] = [];
  let size = 0,
    omitted = 0;
  const add = (prefix: string, entry: SnapshotEntry) => {
    const line =
      prefix +
      renderSnapshot({ url: '', title: '' }, [
        {
          ...entry,
          name: entry.name.slice(0, entry.ref ? 250 : 2000),
          value: entry.value?.slice(0, 200),
        },
      ])
        .text.split('\n')
        .slice(3)
        .join('\n');
    if (size + line.length > 11000) {
      omitted++;
      return;
    }
    size += line.length + 1;
    lines.push(line);
    if (entry.ref) refs.push(entry.ref);
  };
  const old = new Map((before ?? []).filter((e) => e.ref).map((e) => [e.ref, e]));
  const fresh = after.filter((e) => e.ref && !old.has(e.ref));
  const limit = before?.length ? 15 : 40;
  for (const e of fresh.slice(0, limit)) add('Appeared: ', e);
  omitted += Math.max(0, fresh.length - limit);
  let changed = 0;
  for (const e of after) {
    const was = e.ref ? old.get(e.ref) : undefined;
    if (was && (was.name !== e.name || was.value !== e.value || was.role !== e.role)) {
      if (++changed <= 8) add('Changed: ', e);
      else omitted++;
    }
  }
  const alive = new Set(after.map((e) => e.ref));
  const gone = [...old.values()].filter((e) => !alive.has(e.ref));
  if (gone.length) lines.push(`Gone: ${gone.length} controls`);
  const oldText = new Set((before ?? []).filter((e) => !e.ref).map((e) => e.name));
  for (const e of after.filter((e) => !e.ref && !oldText.has(e.name)).slice(0, 8))
    add('New text: ', { ...e, name: e.name.slice(0, 2000) });
  if (omitted) lines.push(`${omitted} more changes omitted; use browser_snapshot if needed.`);
  return { text: lines.join('\n') || 'Nothing changed on screen.', refs };
}
