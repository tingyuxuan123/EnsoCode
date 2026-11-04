// @vitest-environment happy-dom

import { pluginToolName } from '@shared/extensionPlugins/toolName';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { registerPluginSlot, resetPluginSlots } from './registry';
import { PluginBlock, PluginComposerSlots, PluginToolCardSlot } from './slots';

let container: HTMLDivElement;
let root: Root;
const uncaught = vi.fn();
const caught = vi.fn();
const badPlugin = () => {
  throw new Error('fixture plugin render failure');
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  uncaught.mockClear();
  caught.mockClear();
  resetPluginSlots();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container, { onUncaughtError: uncaught, onCaughtError: caught });
});

afterEach(async () => {
  await act(() => root.unmount());
  resetPluginSlots();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('坏掉的输入框挂点不影响输入框和其它插件的按钮', async () => {
  registerPluginSlot({ pluginId: 'test.bad', slot: 'composer.right', component: badPlugin });
  registerPluginSlot({
    pluginId: 'test.good',
    slot: 'composer.right',
    component: () => <button type="button">Healthy plugin</button>,
  });
  await act(() => {
    root.render(
      <>
        <textarea aria-label="Draft" defaultValue="My draft" />
        <PluginComposerSlots side="right" sessionId="s1" draft="My draft" busy={false} />
      </>
    );
  });
  expect(container.querySelector('textarea')?.value).toBe('My draft');
  expect(container.querySelector('button')?.textContent).toBe('Healthy plugin');
  expect(uncaught).not.toHaveBeenCalled();
});

it('插件块失败时显示原始代码，停用后重载的新挂点可接管', async () => {
  const slot = { pluginId: 'test.bad', slot: 'block', language: 'chart' } as const;
  const dispose = registerPluginSlot({ ...slot, component: badPlugin });
  await act(() => {
    root.render(
      <PluginBlock
        pluginId={slot.pluginId}
        lang="chart"
        source="raw chart"
        fallback={<code>raw chart</code>}
      />
    );
  });
  expect(container.querySelector('code')?.textContent).toBe('raw chart');
  await act(() => {
    dispose();
    registerPluginSlot({ ...slot, component: () => <span>Fixed chart</span> });
  });
  expect(container.textContent).toBe('Fixed chart');
  expect(uncaught).not.toHaveBeenCalled();
});

it('插件工具卡失败时宿主的工具结果仍然可见', async () => {
  const pluginId = 'test.bad';
  registerPluginSlot({ pluginId, slot: 'tool.card', toolName: 'lookup', component: badPlugin });
  await act(() => {
    root.render(
      <>
        <output>Original tool output</output>
        <PluginToolCardSlot name={pluginToolName(pluginId, 'lookup')} output="ok" state="ok" />
      </>
    );
  });
  expect(container.querySelector('output')?.textContent).toBe('Original tool output');
  expect(uncaught).not.toHaveBeenCalled();
});

it('半截流式代码先回退，流结束才让失败的挂点重试', async () => {
  const component = vi.fn(({ source }) => {
    const data = JSON.parse(String(source)) as { label: string };
    return <span>{data.label}</span>;
  });
  registerPluginSlot({ pluginId: 'test.json', slot: 'block', language: 'chart', component });
  const render = (source: string, streaming: boolean) =>
    act(() =>
      root.render(
        <PluginBlock
          pluginId="test.json"
          lang="chart"
          source={source}
          streaming={streaming}
          fallback={<code>{source}</code>}
        />
      )
    );
  await render('{', true);
  expect(container.querySelector('code')?.textContent).toBe('{');
  const initialAttempts = component.mock.calls.length;
  await render('{"label":', true);
  expect(component).toHaveBeenCalledTimes(initialAttempts);
  await render('{"label":"Completed chart"}', false);
  expect(container.textContent).toBe('Completed chart');
  expect(container.querySelector('code')).toBeNull();
});
