#!/usr/bin/env npx tsx

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const reviewRoot = path.join(root, 'docs/knowledge-review');
const limits = new Map([
  ['AGENTS.md', 100],
  ['docs/engineering-guidelines.md', 250],
  ['.agents/skills/project-knowledge/SKILL.md', 200],
]);
const requiredSections = ['症状', '根因', '修法', '回归防线', '相关代码'];

function readText(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function filesWithExtension(relativeDir: string, extension: string): string[] {
  const absolute = path.join(root, relativeDir);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(relativeDir, entry.name);
    return entry.isDirectory()
      ? filesWithExtension(relative, extension)
      : entry.name.endsWith(extension)
        ? [relative]
        : [];
  });
}

function markdownFiles(relativeDir: string): string[] {
  return filesWithExtension(relativeDir, '.md');
}

function lineCount(content: string): number {
  return content.split(/\r?\n/).length - (content.endsWith('\n') ? 1 : 0);
}

function referencedMarkdownFiles(): string[] {
  const files = [
    ...limits.keys(),
    ...markdownFiles('docs/engineering-reference'),
    ...markdownFiles('docs/project-history'),
  ];
  const missing = new Set<string>();
  for (const relative of files) {
    const source = readText(relative);
    for (const match of source.matchAll(/\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
      const target = match[1];
      if (!target || target.startsWith('http') || target.startsWith('#')) continue;
      const resolved = path.resolve(path.dirname(path.join(root, relative)), target);
      if (!existsSync(resolved)) missing.add(`${relative} -> ${target}`);
    }
  }
  return [...missing];
}

function bigQuestionIssues(): string[] {
  return markdownFiles('docs/engineering-reference/big-question')
    .filter((relative) => relative.endsWith('.md') && !relative.endsWith('/index.md'))
    .flatMap((relative) => {
      const content = readText(relative);
      const missing = requiredSections.filter((section) => !content.includes(`## ${section}`));
      return missing.length ? [`${relative}: missing ${missing.join(', ')}`] : [];
    });
}

function check(): number {
  let hardIssues = 0;
  console.log('Knowledge base check');
  for (const [relative, limit] of limits) {
    const lines = lineCount(readText(relative));
    const status = lines > limit ? 'WARN' : 'OK';
    console.log(`${status} ${relative}: ${lines}/${limit} lines`);
    if (lines > limit) console.log(`  Review suggested: move stable detail to reference docs.`);
  }
  for (const issue of referencedMarkdownFiles()) {
    console.log(`ERROR ${issue}`);
    hardIssues += 1;
  }
  for (const issue of bigQuestionIssues()) console.log(`WARN ${issue}`);
  const historyFiles = filesWithExtension('docs/project-history', '.md').length;
  console.log(`OK docs/project-history markdown files: ${historyFiles}`);
  console.log(
    hardIssues
      ? `${hardIssues} broken link(s) found; no files changed.`
      : 'No broken links found; review warnings above as needed.'
  );
  return hardIssues ? 1 : 0;
}

function clean(apply: boolean): number {
  const candidates = filesWithExtension('docs/project-history', '.jsonl');
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const destination = path.join(reviewRoot, 'archive', timestamp);
  console.log(apply ? 'Knowledge clean (apply)' : 'Knowledge clean (dry-run)');
  if (!candidates.length) {
    console.log('No temporary knowledge files found.');
    return 0;
  }
  if (!apply) {
    for (const file of candidates) console.log(`Would archive: ${file}`);
    console.log('Re-run with --apply to move files into docs/knowledge-review/archive/.');
    return 0;
  }
  mkdirSync(destination, { recursive: true });
  for (const file of candidates) {
    const target = path.join(destination, path.basename(file));
    renameSync(path.join(root, file), target);
    console.log(`Archived: ${file} -> ${path.relative(root, target)}`);
  }
  return 0;
}

function compactPrompt(files: string[], outputDir: string): void {
  const prompt = `You are maintaining 小满 project knowledge.\n\nFor each source file below, produce a concise replacement draft. Preserve all concrete symptoms, root causes, security boundaries, regression tests, real-device evidence, unfinished decisions, and source links. Remove chatty chronology, duplicate prose, speculative claims, and implementation detail that is no longer a contract. Keep these headings when applicable: 症状, 根因, 修法, 回归防线, 相关代码. Do not invent facts. Return one Markdown draft per source file and a short change summary.\n\nSources:\n${files.map((file) => `- ${file}`).join('\n')}`;
  writeFileSync(path.join(outputDir, 'COMPACT-PROMPT.md'), prompt);
  for (const file of files)
    cpSync(path.join(root, file), path.join(outputDir, path.basename(file)));
}

async function modelCompact(files: string[], outputDir: string): Promise<boolean> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return false;
  const endpoint = `${process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'}/chat/completions`;
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  const source = files.map((file) => `\n\n--- ${file} ---\n${readText(file)}`).join('');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: `Compress these project knowledge files. Preserve facts, evidence, security boundaries, unfinished decisions, and links. Return JSON array [{"file":"relative path","content":"markdown"}]. Do not invent facts.\n${source}`,
        },
      ],
    }),
  });
  if (!response.ok) throw new Error(`knowledge compact model request failed: ${response.status}`);
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  writeFileSync(
    path.join(outputDir, 'MODEL-RESPONSE.md'),
    body.choices?.[0]?.message?.content ?? ''
  );
  return true;
}

async function compact(): Promise<number> {
  const files = markdownFiles('docs/engineering-reference/big-question').filter(
    (file) => lineCount(readText(file)) > 250
  );
  const timestamp = new Date().toISOString().replaceAll(':', '-');
  const outputDir = path.join(reviewRoot, 'compact', timestamp);
  mkdirSync(outputDir, { recursive: true });
  if (!files.length) {
    console.log('No over-limit knowledge entries found. A review directory was not needed.');
    return 0;
  }
  compactPrompt(files, outputDir);
  const usedModel = await modelCompact(files, outputDir);
  console.log(`Prepared ${files.length} source file(s) in ${path.relative(root, outputDir)}.`);
  console.log(
    usedModel
      ? 'Model draft saved as MODEL-RESPONSE.md.'
      : 'No OPENAI_API_KEY; prompt and source copies saved for model review.'
  );
  console.log(
    'Original files were not changed. Apply reviewed drafts manually after checking the diff.'
  );
  return 0;
}

const command = process.argv[2];
let result: number;
if (command === 'check') result = check();
else if (command === 'clean') result = clean(process.argv.includes('--apply'));
else if (command === 'compact') result = await compact();
else {
  console.error('Usage: knowledge.ts <check|clean [--apply]|compact>');
  result = 2;
}
process.exitCode = result;
