import { splitPlanPrefix } from './planMode';

export interface SkillBlock {
  name: string;
  location: string;
  content: string;
}

// Pi warns about non-standard names but still loads them. Resolve by loader identity,
// never treat a command name (including path-like names) as a filesystem path.
const COMMAND = /^\/skill:(\S+)(?=\s|$)/;
const ROLE_PREFIX = /^<role>\n?[\s\S]*?\n?<\/role>\s*/;

/** Only worker-owned plan/role envelopes precede an explicit skill invocation. */
export function splitSkillCommandPrefix(text: string): { prefix: string; input: string } {
  const input = splitPlanPrefix(text).rest.replace(ROLE_PREFIX, '');
  return { prefix: text.slice(0, text.length - input.length), input };
}

export function parseLeadingSkillCommands(text: unknown): { commands: string[]; rest: string } {
  let rest = typeof text === 'string' ? text : '';
  const commands: string[] = [];
  for (let match = COMMAND.exec(rest); match; match = COMMAND.exec(rest)) {
    commands.push(match[0]);
    rest = rest.slice(match[0].length).trimStart();
  }
  return { commands, rest };
}

const escapeAttribute = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\r', '&#13;')
    .replaceAll('\n', '&#10;');
const unescapeAttribute = (text: string) =>
  text.replace(
    /&(amp|quot|lt|gt|#13|#10);/g,
    (entity) =>
      ({ '&amp;': '&', '&quot;': '"', '&lt;': '<', '&gt;': '>', '&#13;': '\r', '&#10;': '\n' })[
        entity
      ] ?? entity
  );

/** Only new chains carry UTF-16 content lengths; skill bodies stay verbatim like Pi. */
export function formatSkillChain(
  commands: readonly string[],
  blocks: readonly SkillBlock[],
  rest: string
): string {
  const used = new Set<string>();
  const parts = commands.map((command) => {
    const name = command.slice('/skill:'.length);
    const block = blocks.find((item) => item.name === name);
    if (!block || used.has(name)) return command;
    used.add(name);
    return `<skill name="${escapeAttribute(block.name)}" location="${escapeAttribute(block.location)}" content-length="${block.content.length}">\n${block.content}\n</skill>`;
  });
  return [...parts, ...(rest ? [rest] : [])].join('\n\n');
}

export function parseSkillInvocation(
  text: string
): { commands: string[]; blocks: SkillBlock[]; rest: string } | null {
  let rest = splitSkillCommandPrefix(text).input;
  const commands: string[] = [];
  const blocks: SkillBlock[] = [];
  while (rest) {
    const command = COMMAND.exec(rest);
    if (command) {
      commands.push(command[0]);
      rest = rest.slice(command[0].length).trimStart();
      continue;
    }
    const header =
      /^<skill name="([^"\r\n]+)" location="([^"\r\n]+)"(?: content-length="(0|[1-9]\d*)")?>\n/.exec(
        rest
      );
    if (!header) {
      // A malformed skill header must not turn the rest of a message into hidden content.
      if (rest.startsWith('<skill ')) return null;
      break;
    }
    // Only Pi's original first block may omit the length. Later legacy XML is
    // user text, not an implicit member of a newly generated chain.
    if (header[3] === undefined && commands.length) break;
    const name = header[3] === undefined ? header[1] : unescapeAttribute(header[1]);
    if (!/^\S+$/.test(name)) return null;
    const start = header[0].length;
    const length = header[3] === undefined ? undefined : Number(header[3]);
    const end = length === undefined ? rest.indexOf('\n</skill>', start) : start + length;
    if (
      (length !== undefined && (!Number.isSafeInteger(length) || length > rest.length)) ||
      end < start ||
      rest.slice(end, end + 9) !== '\n</skill>'
    )
      return null;
    const remaining = rest.slice(end + 9);
    if (remaining && !remaining.startsWith('\n\n')) return null;
    blocks.push({
      name,
      location: length === undefined ? header[2] : unescapeAttribute(header[2]),
      content: rest.slice(start, end),
    });
    commands.push(`/skill:${name}`);
    rest = remaining.slice(2);
    // Legacy/Pi has a single block: its args are literal, not more expanded blocks.
    if (length === undefined) break;
  }
  return blocks.length ? { commands, blocks, rest } : null;
}

export function restoreSkillCommands(text: string): string {
  const parsed = parseSkillInvocation(text);
  return parsed ? [parsed.commands.join(' '), parsed.rest].filter(Boolean).join(' ') : text;
}
