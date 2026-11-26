import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTHORING_TEMPLATES,
  preflightAuthoringManifest,
} from '../../../shared/extensionPlugins/authoringContract';
import { parseExtensionPluginManifest } from '../../../shared/extensionPlugins/manifest';
import { buildAuthoringTemplate } from './authoringTemplates';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('authoring templates', () => {
  it('view restores only its scoped draft, escapes notes, and preserves newer edits and errors', async () => {
    const files = buildAuthoringTemplate({
      id: 'org.example.notes',
      hostVersion: '0.2.110',
      template: 'workspace',
    });
    const window = new Window();
    try {
      const html = files['view.html'];
      window.document.write(html.replace(/<script>[\s\S]*?<\/script>/, ''));
      const storage = new Map([
        ['authoring.notes.draft.scope-a', 'recovered'],
        ['authoring.notes.draft.scope-b', 'other project'],
      ]);
      let resolveSave: (value: unknown) => void = () => {};
      let fail = false;
      const call = vi.fn(async (method: string) => {
        if (fail) throw new Error('bad file');
        if (method === 'addNote')
          return new Promise((resolve) => {
            resolveSave = resolve;
          });
        return { scopeId: 'scope-a', notes: [] };
      });
      Object.assign(window, {
        enso: {
          call,
          storage: {
            get: (key: string) => storage.get(key),
            set: (key: string, value: string) => storage.set(key, value),
            remove: (key: string) => storage.delete(key),
          },
        },
      });
      window.eval(html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '');
      const draft = window.document.querySelector('textarea');
      if (!draft) throw new Error('Missing editor');
      await vi.waitFor(() => expect(draft.value).toBe('recovered'));
      expect(window.document.getElementById('empty')?.hasAttribute('hidden')).toBe(false);
      window.document.getElementById('refresh')?.dispatchEvent(new window.MouseEvent('click'));
      await vi.waitFor(() => expect(call).toHaveBeenCalledTimes(2));
      expect(draft.value).toBe('recovered');
      await vi.waitFor(() => expect(window.document.querySelector('button')?.disabled).toBe(false));
      window.document
        .getElementById('editor')
        ?.dispatchEvent(new window.Event('submit', { cancelable: true }));
      draft.value = 'newer edit';
      draft.dispatchEvent(new window.Event('input'));
      resolveSave({ scopeId: 'scope-a', notes: [{ text: '<script>attack()</script>' }] });
      await vi.waitFor(() =>
        expect(window.document.getElementById('notes')?.textContent).toContain(
          '<script>attack()</script>'
        )
      );
      expect(window.document.querySelector('#notes script')).toBeNull();
      expect(draft.value).toBe('newer edit');
      expect(storage.get('authoring.notes.draft.scope-b')).toBe('other project');
      fail = true;
      window.document.getElementById('refresh')?.dispatchEvent(new window.MouseEvent('click'));
      await vi.waitFor(() =>
        expect(window.document.getElementById('error')?.hasAttribute('hidden')).toBe(false)
      );
      expect(draft.value).toBe('newer edit');
      expect(window.document.getElementById('error')?.textContent).toContain('bad file');
    } finally {
      await window.happyDOM.close();
    }
  });

  for (const { id: template } of AUTHORING_TEMPLATES) {
    it(`${template}: parses, has minimal permissions, and runs generated behavioral tests offline`, async () => {
      const files = buildAuthoringTemplate({
        id: 'org.example.notes',
        hostVersion: '0.2.110',
        template,
        request: '项目 <script>alert(1)</script> 笔记',
      });
      const root = await mkdtemp(join(tmpdir(), 'authoring-template-'));
      roots.push(root);
      for (const [name, content] of Object.entries(files)) {
        await mkdir(dirname(join(root, name)), { recursive: true });
        await writeFile(join(root, name), content);
      }
      const raw = JSON.parse(files['enso-plugin.json']);
      const parsed = parseExtensionPluginManifest(raw, '0.2.110');
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
      expect(preflightAuthoringManifest(parsed.manifest).errors).toEqual([]);
      expect(raw.engines.enso).toBe('>=0.2.110');
      expect(raw.permissions).toEqual(
        template === 'command' ? ['ui.notify'] : template === 'tool' ? ['agent.tool'] : ['ui.view']
      );
      expect(files['main.mjs']).not.toContain('org.example.notes');
      expect(files['README.md']).toContain('node --test');
      expect(files['HOST-CAPABILITIES.md']).toContain('旧宿主');
      execFileSync(process.execPath, ['--check', join(root, 'main.mjs')]);
      // Importing the module alone must not create private data or call host APIs.
      execFileSync(process.execPath, ['--input-type=module', '-e', 'await import("./main.mjs")'], {
        cwd: root,
      });
      const output = execFileSync(process.execPath, ['--test', '--test-reporter=tap'], {
        cwd: root,
        encoding: 'utf8',
      });
      expect(output).toMatch(/# fail 0/);
      expect(await readFile(join(root, 'enso-plugin.json'), 'utf8')).toBe(
        files['enso-plugin.json']
      );
      if (template === 'workspace' || template === 'sidebar') {
        expect(raw.contributes.views[0].location).toBe(
          template === 'workspace' ? 'activitybar' : 'sidebar'
        );
        const html = files['view.html'];
        for (const token of [
          'panel',
          'foreground',
          'primary',
          'primary-foreground',
          'border',
          'muted-foreground',
          'radius',
          'font-family-sans',
          'font-size-base',
        ])
          expect(html).toContain(`var(--${token}`);
        expect(html).not.toContain('<script>alert(1)</script>');
        expect(html).toContain('window.enso');
        expect(html).not.toMatch(/https?:|<script[^>]+src=/);
        const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
        expect(script).toBeTruthy();
        await writeFile(join(root, 'view-script.mjs'), script ?? '');
        execFileSync(process.execPath, ['--check', join(root, 'view-script.mjs')]);
      } else expect(files['view.html']).toBeUndefined();
    });
  }

  it('rejects invalid identifiers and version targets and keeps names within schema limits', () => {
    expect(() =>
      buildAuthoringTemplate({ id: '../escape', hostVersion: '0.2.110', template: 'tool' })
    ).toThrow();
    expect(() =>
      buildAuthoringTemplate({ id: 'org.example.ok', hostVersion: 'bad', template: 'tool' })
    ).toThrow();
    const files = buildAuthoringTemplate({
      id: 'org.example.ok',
      hostVersion: '0.2.110',
      template: 'workspace',
      request: '笔记'.repeat(200),
    });
    expect(JSON.parse(files['enso-plugin.json']).name.length).toBeLessThanOrEqual(60);
    expect(files['README.md']).toContain('笔记'.repeat(200));
  });
});
