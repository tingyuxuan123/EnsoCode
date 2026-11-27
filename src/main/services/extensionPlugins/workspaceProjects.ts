import { basename } from 'node:path';
import {
  type PluginWorkspaceProjects,
  parsePluginWorkspaceContext,
  workspaceContextKey,
} from '@shared/extensionPlugins/workspace';

interface WorkspaceSource {
  projects: readonly { projectId: string; canonicalPath: string; kind?: string; state: string }[];
  conversations: readonly {
    conversationId: string;
    projectId: string;
    kind: string;
    lifecycle: string;
    superAssistant?: boolean;
  }[];
  rootForSession(id: string): string | null;
}
const local = (project: WorkspaceSource['projects'][number]) =>
  project.state === 'active' && (project.kind === undefined || project.kind === 'local');
const rootConversation = (conversation: WorkspaceSource['conversations'][number]) =>
  conversation.kind === 'root' &&
  conversation.lifecycle !== 'ended' &&
  !conversation.superAssistant;

export function resolveWorkspaceProject(
  source: WorkspaceSource,
  raw: unknown
): { projectRoot: string | null } | null {
  const context = parsePluginWorkspaceContext(raw);
  if (context === undefined) return null;
  if (context === null) return { projectRoot: null };
  const project = source.projects.find(
    (item) => item.projectId === context.projectId && local(item)
  );
  if (!project) return null;
  if (!context.conversationId) return { projectRoot: project.canonicalPath };
  const conversation = source.conversations.find(
    (item) =>
      item.conversationId === context.conversationId &&
      item.projectId === project.projectId &&
      rootConversation(item)
  );
  const root = conversation ? source.rootForSession(conversation.conversationId) : null;
  return root ? { projectRoot: root } : null;
}

export function listWorkspaceProjects(
  source: WorkspaceSource,
  origin: string | null
): PluginWorkspaceProjects {
  const projects = source.projects.filter(local);
  const choices: PluginWorkspaceProjects['projects'] = projects.map((project) => {
    const context = { projectId: project.projectId };
    return {
      key: workspaceContextKey(context),
      name: basename(project.canonicalPath),
      kind: 'project',
      context,
    };
  });
  const roots = new Set(projects.map((project) => project.canonicalPath));
  for (const conversation of source.conversations.filter(rootConversation)) {
    const project = projects.find((item) => item.projectId === conversation.projectId);
    const root = project ? source.rootForSession(conversation.conversationId) : null;
    if (!project || !root || roots.has(root)) continue;
    roots.add(root);
    const context = { projectId: project.projectId, conversationId: conversation.conversationId };
    choices.push({
      key: workspaceContextKey(context),
      name: `${basename(project.canonicalPath)} · ${basename(root)}`,
      kind: 'worktree',
      context,
    });
  }
  const conversation = source.conversations.find(
    (item) => item.conversationId === origin && rootConversation(item)
  );
  const root = conversation ? source.rootForSession(conversation.conversationId) : null;
  const current = root
    ? (choices.find((item) => resolveWorkspaceProject(source, item.context)?.projectRoot === root)
        ?.context ?? null)
    : null;
  return { current, projects: choices };
}
