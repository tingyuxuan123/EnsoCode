/** Type-only subset; the upstream attachment validator is not exposed. */
export interface PluginPromptContext<TPayload extends object = object> {
  schema: string;
  version: number;
  payload: TPayload;
}
export interface PluginPromptAttachment<TPayload extends object = object> {
  id: string;
  label: string;
  labels?: string[];
  icon?: string;
  lifecycle?: 'once' | 'sticky';
  context?: PluginPromptContext<TPayload>;
  instructions?: string[];
  metadata?: Record<string, unknown>;
}
