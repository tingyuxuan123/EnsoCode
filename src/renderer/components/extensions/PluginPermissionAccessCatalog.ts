import type { ExtensionPluginPermission } from '@shared/extensionPlugins/manifest';

export const PERMISSION_GROUPS = [
  'interface',
  'project',
  'session',
  'execution',
  'external',
  'unknown',
] as const;
export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];
export type PermissionRisk = 'low' | 'medium' | 'high';
type Endpoint =
  | 'interface'
  | 'notifications'
  | 'draft'
  | 'files'
  | 'network'
  | 'mcp'
  | 'agent'
  | 'process'
  | 'plugins'
  | 'clipboard'
  | 'systemBrowser'
  | 'sessions'
  | 'model'
  | 'browser';

interface KnownPermission {
  group: Exclude<PermissionGroup, 'unknown'>;
  risk: PermissionRisk;
  label: string;
  summary: string;
  scope: string;
  flow: readonly [Endpoint, 'receive' | 'send' | 'exchange'];
}

/** Host API capabilities only. This data is explanatory, never an authorization decision. */
const catalog: Record<ExtensionPluginPermission, KnownPermission> = {
  'agent.tool': {
    group: 'execution',
    risk: 'medium',
    label: 'Provide agent tools',
    summary: 'The agent can call tools contributed by this plugin.',
    scope: 'Plugin tool calls are subject to the host’s tool approval and session rules.',
    flow: ['agent', 'exchange'],
  },
  'ui.slot': {
    group: 'interface',
    risk: 'high',
    label: 'Extend the main interface',
    summary: 'Adds components or suggestions to supported parts of CodeKiln’s interface.',
    scope:
      'Host slots and contributed suggestions. If the plugin ships ui.js, that module runs with main-interface access.',
    flow: ['interface', 'exchange'],
  },
  'ui.view': {
    group: 'interface',
    risk: 'low',
    label: 'Provide plugin views',
    summary: 'Contributes sidebar views or file viewers and exchanges data with its own views.',
    scope: 'The plugin’s declared views and file viewers, not arbitrary CodeKiln panels.',
    flow: ['interface', 'exchange'],
  },
  'ui.notify': {
    group: 'interface',
    risk: 'low',
    label: 'Show notifications',
    summary: 'Asks CodeKiln to display system notifications.',
    scope: 'Notifications sent through the host are subject to current notification settings.',
    flow: ['notifications', 'send'],
  },
  'composer.draft': {
    group: 'interface',
    risk: 'medium',
    label: 'Read and edit the draft',
    summary: 'Reads or edits unsent text in the conversation composer; does not submit it.',
    scope:
      'The invocation’s composer. Host draft writes check the current version and editing state.',
    flow: ['draft', 'exchange'],
  },
  'fs.read': {
    group: 'project',
    risk: 'medium',
    label: 'Read project files',
    summary: 'Reads text from project files through the host file API.',
    scope: 'Project-relative locations declared by the plugin. Exact paths are not shown here.',
    flow: ['files', 'receive'],
  },
  'fs.write': {
    group: 'project',
    risk: 'high',
    label: 'Write project files',
    summary: 'Writes text to project files through the host file API.',
    scope:
      'Declared project-relative locations, subject to session write policy. Exact paths are not shown here.',
    flow: ['files', 'send'],
  },
  'net.fetch': {
    group: 'external',
    risk: 'high',
    label: 'Make network requests',
    summary: 'Sends requests and receives responses through the host network API.',
    scope: 'Host requests are limited to declared network hosts. Exact hosts are not shown here.',
    flow: ['network', 'exchange'],
  },
  'mcp.server': {
    group: 'execution',
    risk: 'high',
    label: 'Provide MCP servers',
    summary: 'Contributes MCP servers that CodeKiln can start and use.',
    scope:
      'Declared local server commands, arguments and environment. Exact commands are not shown here.',
    flow: ['mcp', 'exchange'],
  },
  'mcp.call': {
    group: 'execution',
    risk: 'high',
    label: 'Call MCP tools',
    summary: 'Sends arguments to MCP tools and reads their results.',
    scope:
      'Declared server/tool pairs in the current session, subject to host policy. Exact tools are not shown here.',
    flow: ['mcp', 'exchange'],
  },
  'agent.observe': {
    group: 'session',
    risk: 'medium',
    label: 'Observe agent events',
    summary: 'Receives data from subscribed agent or session events without changing those events.',
    scope: 'Declared event subscriptions and the event data the host exposes to them.',
    flow: ['agent', 'receive'],
  },
  'agent.intercept': {
    group: 'session',
    risk: 'high',
    label: 'Influence agent events',
    summary:
      'Intercepts declared events and can affect the agent’s input or tool results where allowed.',
    scope:
      'Declared interceptable events only. Allowed changes depend on the event and host policy.',
    flow: ['agent', 'exchange'],
  },
  'agent.inject': {
    group: 'session',
    risk: 'high',
    label: 'Send messages or stop a turn',
    summary: 'Can inject a message, trigger a turn, or ask CodeKiln to stop a running session.',
    scope:
      'Limited to the originating session unless cross-session access is explicitly allowed. Host session restrictions still apply.',
    flow: ['sessions', 'send'],
  },
  'process.background': {
    group: 'execution',
    risk: 'medium',
    label: 'Run in the background',
    summary: 'Allows the plugin to stay active or run declared scheduled tasks.',
    scope:
      'The plugin’s own background process and declared schedules. It does not add file or session permissions.',
    flow: ['process', 'receive'],
  },
  'plugin.call': {
    group: 'execution',
    risk: 'medium',
    label: 'Call other plugins',
    summary: 'Sends arguments to permitted plugins and receives their results.',
    scope:
      'Calls are limited to declared peer plugins and methods they expose for inter-plugin use.',
    flow: ['plugins', 'exchange'],
  },
  'ui.clipboard': {
    group: 'interface',
    risk: 'medium',
    label: 'Write to the clipboard',
    summary: 'Copies text to the system clipboard through the host.',
    scope: 'Text writes require a user action; this permission does not grant clipboard reads.',
    flow: ['clipboard', 'send'],
  },
  'ui.openExternal': {
    group: 'external',
    risk: 'low',
    label: 'Open external links',
    summary: 'Opens a URL outside CodeKiln through the host.',
    scope: 'Requires a user action and a URL accepted by the host.',
    flow: ['systemBrowser', 'send'],
  },
  'session.read': {
    group: 'session',
    risk: 'medium',
    label: 'Read project session information',
    summary: 'Reads session lists and status within the current project.',
    scope:
      'Project session information exposed by the host. This is not access to arbitrary chat history.',
    flow: ['sessions', 'receive'],
  },
  'session.readAll': {
    group: 'session',
    risk: 'high',
    label: 'Read session information across projects',
    summary: 'Reads session lists and status beyond the current project.',
    scope:
      'Sessions exposed by the host across projects. This does not add permission to read conversation transcripts.',
    flow: ['sessions', 'receive'],
  },
  'session.focus': {
    group: 'session',
    risk: 'low',
    label: 'Switch between sessions',
    summary: 'Focuses an existing session or opens a related agent view.',
    scope:
      'A user action is required. The host checks that the target belongs to the current project.',
    flow: ['sessions', 'send'],
  },
  'session.create': {
    group: 'session',
    risk: 'medium',
    label: 'Create sessions',
    summary: 'Creates a session and can provide initial draft text.',
    scope:
      'A user action is required. Any plugin preset used to create the session must belong to this plugin.',
    flow: ['sessions', 'send'],
  },
  'agent.run': {
    group: 'execution',
    risk: 'high',
    label: 'Run a read-only agent',
    summary: 'Starts a temporary model run to read or search and receives the result.',
    scope:
      'An eligible local session and a read-only tool set. Depending on the request, conversation context may be sent to the model service.',
    flow: ['model', 'exchange'],
  },
  'browser.control': {
    group: 'external',
    risk: 'high',
    label: 'Control the built-in browser',
    summary: 'Reads or interacts with web pages through CodeKiln’s browser API.',
    scope:
      'Declared HTTPS hosts and tabs belonging to an eligible local session. Writes follow session policy; exact hosts are not shown here.',
    flow: ['browser', 'exchange'],
  },
};

export function knownPermission(id: string): KnownPermission | undefined {
  return Object.hasOwn(catalog, id) ? catalog[id as ExtensionPluginPermission] : undefined;
}
