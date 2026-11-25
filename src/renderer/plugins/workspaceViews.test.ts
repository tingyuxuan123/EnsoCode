import { afterEach, expect, it } from 'vitest';
import type { PluginViewRef } from './viewBridge';
import {
  activitybarPluginViews,
  closePluginWorkspace,
  getPluginWorkspace,
  openPluginWorkspace,
  reconcilePluginWorkspace,
  sidebarPluginViews,
} from './workspaceViews';

const memory: PluginViewRef = {
  pluginId: 'codekiln.memory',
  pluginName: 'Memory',
  id: 'memory',
  title: 'Memory',
  entry: 'memory.html',
  location: 'activitybar',
};
const notes: PluginViewRef = {
  pluginId: 'example.notes',
  pluginName: 'Notes',
  id: 'notes',
  title: 'Notes',
  entry: 'notes.html',
};
afterEach(() => closePluginWorkspace());

it('activitybar pages do not also appear as right sidebar tabs', () => {
  expect(activitybarPluginViews([memory, notes])).toEqual([memory]);
  expect(sidebarPluginViews([memory, notes])).toEqual([notes]);
  expect(openPluginWorkspace(notes, 'a')).toBe(false);
  expect(getPluginWorkspace()).toBeNull();
});
it('binds a page to its originating session, and allows a global view without a session', () => {
  expect(openPluginWorkspace(memory, null)).toBe(true);
  expect(getPluginWorkspace()).toEqual({
    pluginId: memory.pluginId,
    viewId: memory.id,
    sessionId: null,
  });
  openPluginWorkspace(memory, 'a');
  expect(getPluginWorkspace()?.sessionId).toBe('a');
  closePluginWorkspace({ pluginId: 'other.plugin', viewId: memory.id, sessionId: 'a' });
  expect(getPluginWorkspace()).not.toBeNull();
  closePluginWorkspace({ pluginId: memory.pluginId, viewId: memory.id, sessionId: 'b' });
  expect(getPluginWorkspace()).not.toBeNull();
  closePluginWorkspace({ pluginId: memory.pluginId, viewId: memory.id, sessionId: 'a' });
  expect(getPluginWorkspace()).toBeNull();
});
it('revokes disabled, removed and relocated pages without closing unrelated views', () => {
  openPluginWorkspace(memory, 'a');
  reconcilePluginWorkspace([memory, notes]);
  expect(getPluginWorkspace()).not.toBeNull();
  reconcilePluginWorkspace([{ ...memory, location: 'sidebar' }]);
  expect(getPluginWorkspace()).toBeNull();
  openPluginWorkspace(memory, 'a');
  reconcilePluginWorkspace([]);
  expect(getPluginWorkspace()).toBeNull();
});
