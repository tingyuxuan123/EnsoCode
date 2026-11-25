// @vitest-environment happy-dom
import { EXTENSION_PLUGIN_PERMISSIONS } from '@shared/extensionPlugins/manifest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PLUGIN_TRUST_WARNING } from '@/plugins/NativePluginFlows';
import { PluginPermissionAccess } from './PluginPermissionAccess';

vi.mock('@/i18n', async () => {
  const { translate } = await import('@shared/i18n');
  return {
    useI18n: () => ({
      t: (key: string, params?: Record<string, string | number>) => translate('en', key, params),
    }),
  };
});
vi.mock('@/components/settings/PluginModelConfigField', () => ({
  PluginModelConfigField: () => null,
}));

let container: HTMLDivElement;
let root: Root;
const onBack = vi.fn();

async function render(props: Partial<React.ComponentProps<typeof PluginPermissionAccess>> = {}) {
  await act(async () =>
    root.render(
      <PluginPermissionAccess
        pluginName="Notes"
        permissions={[]}
        mode="available"
        onBack={onBack}
        {...props}
      />
    )
  );
}

function details() {
  return container.querySelector('aside');
}

function row(permission: string) {
  const match = [...container.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find(
    (button) => button.querySelector('code')?.textContent === permission
  );
  if (!match) throw new Error(`No row for ${permission}`);
  return match;
}

function stat(label: string) {
  return [...container.querySelectorAll('dt')].find((term) => term.textContent === label)
    ?.nextElementSibling?.textContent;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  onBack.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it('shows zero declared host scopes without implying that a plugin is sandboxed or granted access', async () => {
  await render();
  expect(stat('Declared permissions')).toBe('0');
  expect(stat('High risk')).toBe('0');
  expect(stat('Access status')).toBe('Reviewed at installation');
  expect(container.textContent).toContain('No declared host permissions');
  expect(container.textContent).toContain(PLUGIN_TRUST_WARNING);
  expect(details()).toBeNull();
  expect(container.querySelector('[role="switch"]')).toBeNull();
  const back = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Back to extension details"][data-slot="permission-access-back"]'
  );
  expect(back).not.toBeNull();
  await act(async () => back?.click());
  expect(onBack).toHaveBeenCalledOnce();
});

it('labels pending candidate permissions and reports the version only once', async () => {
  await render({
    mode: 'update',
    pendingVersion: '9.42.17',
    permissions: ['fs.write'],
    versionSwitcher: <button type="button">Pending version 9.42.17</button>,
  });
  expect(stat('Access status')).toBe('Pending approval');
  expect(stat('High risk')).toBe('1');
  expect(container.textContent?.match(/9\.42\.17/g)).toHaveLength(1);
  expect(container.querySelector('header')?.nextElementSibling?.textContent).toBe(
    'Pending version 9.42.17'
  );
  expect(container.textContent).toContain(
    'These are the update candidate’s declarations, not the current installation’s permissions.'
  );
  expect(container.querySelector('[role="switch"]')).toBeNull();
  await render({ mode: 'update', pendingVersion: '9.42.18' });
  expect(stat('Access status')).toBe('Update candidate');
  expect(container.textContent).not.toContain('9.42.17');
  expect(container.textContent?.match(/9\.42\.18/g)).toHaveLength(1);
});

it('deduplicates declared capabilities, counts known risks, and switches the inspector across groups', async () => {
  await render({
    mode: 'installed',
    permissions: ['fs.read', 'fs.write', 'fs.write', 'ui.notify'],
  });
  expect(stat('Declared permissions')).toBe('3');
  expect(stat('High risk')).toBe('1');
  expect(stat('Access status')).toBe('Current installation');
  await act(async () => row('fs.read').click());
  expect(details()?.querySelector('h3')?.textContent).toBe('Read project files');
  expect(details()?.querySelector('figure')?.textContent).toMatch(/Project files.*Plugin/);
  await act(async () => row('fs.write').click());
  expect(row('fs.write').getAttribute('aria-pressed')).toBe('true');
  expect(row('fs.read').getAttribute('aria-pressed')).toBe('false');
  expect(details()?.querySelector('h3')?.textContent).toBe('Write project files');
  expect(details()?.querySelector('figure')?.textContent).toMatch(/Plugin.*Project files/);
  expect(details()?.previousElementSibling?.contains(row('fs.write'))).toBe(true);
  await render({ mode: 'installed', permissions: ['ui.notify'] });
  expect(row('ui.notify').getAttribute('aria-pressed')).toBe('true');
  expect(details()?.querySelector('h3')?.textContent).toBe('Show notifications');
});

it('treats new signed identifiers and prototype keys as unclassified instead of assuming low risk', async () => {
  await render({ permissions: ['future.scope', 'constructor', '__proto__'] });
  expect(stat('Declared permissions')).toBe('3');
  expect(stat('High risk')).toBe('0');
  expect(container.textContent).toContain(
    'Unclassified permissions are not included in the high-risk count.'
  );
  await act(async () => row('__proto__').click());
  expect(details()?.textContent).toContain('__proto__');
  expect(details()?.textContent).toContain('Unclassified');
  expect(details()?.textContent).not.toMatch(/Low risk|Medium risk|High risk/);
  expect(details()?.querySelector('figure')).toBeNull();
});

it('renders only the provided installed cross-session control under agent.inject', async () => {
  const onChange = vi.fn();
  const crossSession = { enabled: false, disabled: false, onChange };
  await render({ mode: 'installed', permissions: ['agent.inject'] });
  expect(container.querySelector('[role="switch"]')).toBeNull();
  await render({ mode: 'installed', permissions: ['agent.inject'], crossSession });
  const toggle = container.querySelector<HTMLElement>('[role="switch"]');
  expect(toggle?.closest('li')?.contains(row('agent.inject'))).toBe(true);
  expect(toggle?.getAttribute('aria-checked')).toBe('false');
  await act(async () => toggle?.click());
  expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
  expect(toggle?.getAttribute('aria-checked')).toBe('false');
  await render({
    mode: 'installed',
    permissions: ['agent.inject'],
    crossSession: { ...crossSession, enabled: true, disabled: true },
  });
  expect(toggle?.getAttribute('aria-checked')).toBe('true');
  expect(toggle?.getAttribute('aria-disabled')).toBe('true');
  await act(async () => toggle?.click());
  expect(onChange).toHaveBeenCalledOnce();
  await render({ mode: 'installed', permissions: ['agent.observe'], crossSession });
  expect(container.querySelector('[role="switch"]')).toBeNull();
  await render({ mode: 'update', permissions: ['agent.inject'], crossSession });
  expect(container.querySelector('[role="switch"]')).toBeNull();
});

it('classifies every permission recognized by the current manifest', async () => {
  await render({ permissions: EXTENSION_PLUGIN_PERMISSIONS });
  expect(stat('Declared permissions')).toBe(String(EXTENSION_PLUGIN_PERMISSIONS.length));
  expect(container.querySelectorAll('button[aria-pressed]')).toHaveLength(
    EXTENSION_PLUGIN_PERMISSIONS.length
  );
  expect(container.textContent).not.toContain('Unclassified');
});
