/** Display-only projection. Labels never authorize actions or rewrite the worker's history. */
export interface BrowserLabel {
  text?: string;
  key?: string;
  target?: string;
}
export interface BrowserStepView {
  ordinal: number;
  label: BrowserLabel;
  status: 'completed' | 'running' | 'failed' | 'pending';
}
export interface BrowserToolView {
  label: BrowserLabel;
  steps: BrowserStepView[];
  count: number;
  error?: string;
  warning?: string;
}
export type BrowserToolState = 'running' | 'reviewing' | 'ok' | 'error';
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, limit = 160): string | undefined =>
  typeof v === 'string' && v.trim()
    ? v
        .replace(/\p{Cc}/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, limit)
    : undefined;
const outputText = (value: string | null) => (value ?? '').split(/\n<source_reference\b/, 1)[0];
function resultRecord(output: string | null): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(outputText(output));
    return record(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function address(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'file:'
      ? text(url.pathname.split('/').at(-1))
      : text(`${url.host}${url.pathname === '/' ? '' : url.pathname}`);
  } catch {
    return undefined;
  }
}
function description(args: Record<string, unknown>): string | undefined {
  const label = text(args.description);
  if (!label || /browser_\w+|snapshotId|tabId|\[ref=|^\s*[{[]/.test(label)) return undefined;
  // A model-provided label is not a license to echo a password or any typed field value.
  for (const value of typedValues(args)) if (label.includes(value)) return undefined;
  return label;
}
function typedValues(args: Record<string, unknown>): string[] {
  const rows = [args, ...(Array.isArray(args.steps) ? args.steps.filter(record).slice(0, 10) : [])];
  return rows
    .flatMap((row) => ['text', 'value'].map((key) => row[key]))
    .filter((value): value is string => typeof value === 'string' && !!value);
}
function stepLabel(
  action: string,
  args: Record<string, unknown>,
  refs: ReadonlyMap<string, string>
): BrowserLabel {
  const said = description(args);
  if (said) return { text: said };
  const rawTarget =
    text(args.target) ?? (typeof args.ref === 'string' ? refs.get(args.ref) : undefined);
  const target =
    rawTarget && !typedValues(args).some((value) => rawTarget.includes(value))
      ? rawTarget
      : undefined;
  const aimed = (key: string, fallback: string): BrowserLabel =>
    target ? { key, target } : { key: fallback };
  switch (action) {
    case 'navigate':
      return address(args.url)
        ? { key: 'Open {{target}}', target: address(args.url) }
        : { key: 'Open page' };
    case 'click':
    case 'click_xy':
      return aimed('Click {{target}}', 'Click page control');
    case 'type':
    case 'fill':
      return aimed('Fill {{target}}', 'Fill a field');
    case 'press':
    case 'press_key':
      return text(args.key)
        ? { key: 'Press {{target}}', target: text(args.key) }
        : { key: 'Press a key' };
    case 'scroll':
    case 'scroll_into_view':
      return { key: 'Scroll page' };
    case 'select':
    case 'select_option':
      return aimed('Select {{target}}', 'Select an option');
    case 'check':
    case 'set_checked':
      return aimed(
        args.checked === false ? 'Uncheck {{target}}' : 'Check {{target}}',
        'Update selection'
      );
    case 'hover':
      return aimed('Hover over {{target}}', 'Hover over page control');
    case 'wait':
      return { key: 'Wait for page' };
    case 'read':
    case 'snapshot':
      return { key: 'Read page content' };
    case 'screenshot':
      return { key: 'Take screenshot' };
    case 'navigation':
      return {
        key:
          (
            {
              back: 'Go back',
              forward: 'Go forward',
              reload: 'Reload page',
              search: 'Search the web',
              reveal: 'Show browser',
              stop: 'Stop loading',
            } as Record<string, string>
          )[String(args.action)] ?? 'Navigate page',
      };
    case 'tabs':
      return { key: 'Manage browser tabs' };
    case 'device':
      return { key: 'Preview page layout' };
    case 'downloads':
      return { key: 'Manage downloads' };
    case 'history':
      return { key: 'View browsing history' };
    case 'drag':
      return { key: 'Drag page control' };
    case 'lock':
      return { key: 'Keep browser open' };
    case 'act':
      return { key: 'Operate browser' };
    default:
      return { key: 'Inspect page' };
  }
}

export function browserPresentation(
  name: string,
  raw: unknown,
  output: string | null,
  state: BrowserToolState,
  refs: ReadonlyMap<string, string> = new Map()
): BrowserToolView | undefined {
  if (!name.startsWith('browser_')) return undefined;
  const args = record(raw) ? raw : {};
  const data = resultRecord(output);
  const action = name === 'browser_interact' ? String(args.action) : name.slice('browser_'.length);
  const label = stepLabel(action, args, refs);
  const rawSteps =
    name === 'browser_act' && Array.isArray(args.steps)
      ? args.steps.filter(record).slice(0, 10)
      : [];
  const body = outputText(output);
  const stopped = /browser_act step (\d+) stopped \((\d+) completed\)/.exec(body);
  const completed =
    typeof data.completed === 'number' && Number.isSafeInteger(data.completed)
      ? Math.max(0, Math.min(rawSteps.length, data.completed))
      : stopped
        ? Math.min(rawSteps.length, Number(stopped[2]))
        : 0;
  const failedIndex = state === 'error' ? (stopped ? Number(stopped[1]) - 1 : completed) : -1;
  const steps = rawSteps.map(
    (step, i): BrowserStepView => ({
      ordinal: i + 1,
      label: stepLabel(String(step.action), step, refs),
      status: i < completed ? 'completed' : i === failedIndex ? 'failed' : 'pending',
    })
  );
  const error =
    state === 'error'
      ? (text(data.error, 6000) ??
        text(data.message, 6000) ??
        (body.trim().startsWith('{') ? undefined : body.trim().slice(0, 6000)))
      : undefined;
  const redact = (value: string) =>
    typedValues(args)
      .sort((a, b) => b.length - a.length)
      .reduce((result, secret) => result.split(secret).join('••••'), value);
  return {
    label,
    steps,
    count: rawSteps.length
      ? Math.max(1, completed + (failedIndex >= completed && failedIndex < rawSteps.length ? 1 : 0))
      : 1,
    ...(error ? { error: redact(error) } : {}),
    ...(typeof data.observationError === 'string'
      ? { warning: redact(data.observationError.slice(0, 6000)) }
      : typeof data.notice === 'string'
        ? { warning: redact(data.notice.slice(0, 6000)) }
        : {}),
  };
}

/** Keep only names of controls actually present in tool observations; never store field values. */
export function recordBrowserRefs(refs: Map<string, string>, output: string | null): void {
  const data = resultRecord(output);
  const add = (ref: unknown, name: unknown) => {
    if (typeof ref !== 'string' || !/^[\w:-]{1,160}$/.test(ref) || !text(name, 200)) return;
    if (refs.size >= 1000) refs.delete(refs.keys().next().value!);
    refs.set(ref, text(name, 200)!);
  };
  if (Array.isArray(data.entries))
    for (const entry of data.entries) if (record(entry)) add(entry.ref, entry.name);
  const source = typeof data.observation === 'string' ? data.observation : outputText(output);
  for (const match of source
    .slice(0, 200000)
    .matchAll(/-\s+\S+\s+"((?:\\.|[^"\\])*)"\s+\[ref=([^\]]+)\]/g)) {
    try {
      add(match[2], JSON.parse(`"${match[1]}"`));
    } catch {
      /* malformed page labels cannot break the timeline */
    }
  }
}

export function browserResultTab(output: string | null): string | undefined {
  const data = resultRecord(output);
  return text(data.tabId) ?? text(data.selected) ?? text(data.opened);
}
