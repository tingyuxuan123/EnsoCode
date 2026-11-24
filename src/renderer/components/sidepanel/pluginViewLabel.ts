/** Avoid repeating the plugin name when its view already uses that name. */
export function pluginViewLabel(view: { title: string; pluginName: string }): string {
  return view.title === view.pluginName ? view.title : `${view.title} · ${view.pluginName}`;
}
