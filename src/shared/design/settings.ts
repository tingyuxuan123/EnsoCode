import { effectiveDisabledBuiltinTools } from '../types/builtinTools';

/** Feed the global design switch through the existing generation-bound builtin hot-loadout
 * pipeline. Project overrides cannot turn back on a globally disabled design subsystem. */
export function designToolSettings(
  state: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (state?.designEnabled !== false) return state;
  const disable = (value: unknown) => [
    ...new Set([...effectiveDisabledBuiltinTools(value), 'design']),
  ];
  return {
    ...state,
    disabledBuiltinTools: disable(state.disabledBuiltinTools),
    projects: Array.isArray(state.projects)
      ? state.projects.map((project: unknown) => {
          if (!project || typeof project !== 'object' || Array.isArray(project)) return project;
          const record = project as Record<string, unknown>;
          return Array.isArray(record.disabledBuiltinTools)
            ? { ...record, disabledBuiltinTools: disable(record.disabledBuiltinTools) }
            : project;
        })
      : state.projects,
  };
}
