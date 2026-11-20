const WIKILINK_PREFIX = 'wikilink://';

/**
 * Convert [[slug]] and [[slug|Alias]] inside prose into safe clickable links
 * while preserving fenced code blocks (` ``` ` / `~~~`) and inline code spans.
 */
export function injectWikiLinksIntoMarkdown(markdown: string): string {
  if (!markdown.includes('[[')) return markdown;
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let inFence: string | null = null;

  for (const line of lines) {
    const trimmed = line.trimStart();
    const fenceMatch = /^(```+|~~~+)/.exec(trimmed);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!inFence) inFence = marker;
      else if (inFence === marker) inFence = null;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    out.push(replaceOutsideInlineCode(line));
  }
  return out.join('\n');
}

function replaceOutsideInlineCode(line: string): string {
  const parts = line.split(/(`+[^`]*`+)/g);
  return parts
    .map((part, idx) => {
      if (idx % 2 === 1) return part;
      return part.replace(/\[\[([^[\]]+?)\]\]/g, (_match, raw: string) => {
        const pipe = raw.indexOf('|');
        const target = (pipe === -1 ? raw : raw.slice(0, pipe)).trim();
        const alias = (pipe === -1 ? target : raw.slice(pipe + 1)).trim() || target;
        if (!target) return _match;
        const safeLabel = alias.replace(/([[\]])/g, '\\$1');
        return `[${safeLabel}](${WIKILINK_PREFIX}${encodeURIComponent(target)})`;
      });
    })
    .join('');
}

export function parseWikiLinkHref(href?: string | null): string | null {
  if (!href?.startsWith(WIKILINK_PREFIX)) return null;
  const raw = href.slice(WIKILINK_PREFIX.length);
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw).trim();
    return decoded || null;
  } catch {
    return null;
  }
}
