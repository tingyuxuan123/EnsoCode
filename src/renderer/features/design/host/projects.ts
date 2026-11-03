import type { DesignProjectEntry } from '@shared/types/design';
import { useSettingsStore } from '@/stores/settings';
import type { PluginOfficialProjectEntry } from '../vetta/sdk/official';
import { resolveDesignRoot } from './paths';

async function projectSnapshot() {
  const result = await window.electronAPI.design.projects({ op: 'list' });
  if (!result.ok) throw new Error(result.error);
  if (!('projects' in result)) throw new Error('Missing design project list');
  return result;
}
export async function listGalleryProjects() {
  const snapshot = await projectSnapshot();
  const names = new Map(
    useSettingsStore.getState().projects.map((project) => [project.id, project.name])
  );
  const resolve = async (entries: DesignProjectEntry[]): Promise<PluginOfficialProjectEntry[]> => {
    const sources = await Promise.allSettled(
      entries.map(async (entry) => {
        const root = await resolveDesignRoot({ kind: 'project', projectId: entry.projectId });
        return { name: names.get(entry.projectId) ?? entry.path.split('/').pop(), path: root.path };
      })
    );
    // A missing/inaccessible project is a failed source, never a failed gallery.
    return sources.flatMap((source) => (source.status === 'fulfilled' ? [source.value] : []));
  };
  return {
    workspacePath: snapshot.workspacePath,
    projects: await resolve(snapshot.projects),
    archivedProjects: await resolve(snapshot.archivedProjects),
  };
}
export async function createGalleryProject(name: string): Promise<PluginOfficialProjectEntry> {
  const result = await window.electronAPI.design.projects({ op: 'create', name });
  if (!result.ok) throw new Error(result.error);
  if (!('project' in result)) throw new Error('Missing created design project');
  const project = await useSettingsStore.getState().addProject(result.project.path);
  if (!project) throw new Error('Could not register design project');
  const root = await resolveDesignRoot({ kind: 'project', projectId: project.id });
  return { path: root.path, name: name.trim() };
}
export async function setGalleryProjectArchived(cwd: string, archived: boolean): Promise<void> {
  const snapshot = await projectSnapshot();
  const project = [...snapshot.projects, ...snapshot.archivedProjects].find(
    (entry) => entry.path === cwd
  );
  if (!project) throw new Error('Local design project is unavailable');
  const result = await window.electronAPI.design.projects({
    op: 'setArchived',
    projectId: project.projectId,
    archived,
  });
  if (!result.ok) throw new Error(result.error);
}
