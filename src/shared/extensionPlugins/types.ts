import type { ExtensionPluginPermission, PluginTriggerSymbol } from './manifest';
export interface ExtensionPluginListResult {
  plugins: ExtensionPluginSummary[];
  registryError?: string;
}
export interface ExtensionPluginSummary {
  id: string;
  name: string;
  version: string;
  description: string;
  state: 'disabled' | 'enabled' | 'crashed';
  permissions: ExtensionPluginPermission[];
  tools: { name: string; description: string }[];
  commands: { id: string; title: string }[];
  views: { id: string; title: string; entry: string }[];
  triggers: { symbol: PluginTriggerSymbol; name: string }[];
  hasRenderer: boolean;
  renderer?: string;
  configurable: boolean;
  presets: { id: string; name: string; skills: number; mcpServers: number; instruction: boolean }[];
  pendingVersion?: string;
  pendingPermissions?: ExtensionPluginPermission[];
}
export interface ExtensionPluginConfigField {
  key: string;
  title: string;
  description: string;
  secret: boolean;
  set: boolean;
  value?: string;
}
export interface ExtensionPluginInstallPreview {
  token: string;
  id: string;
  name: string;
  version: string;
  description: string;
  permissions: ExtensionPluginPermission[];
  fsRead: string[];
  fsWrite: string[];
  netDomains: string[];
  mcpServers: { name: string; command: string; args: string[]; envKeys: string[] }[];
  mcpTools: string[];
  tools: { name: string; description: string }[];
  hasRenderer: boolean;
  warnings: string[];
  existingVersion?: string;
  expands: boolean;
}
export interface PluginToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  pluginId: string;
  /** Installed generation + manifest fingerprint: old workers cannot invoke an updated plugin. */
  fingerprint: string;
}
