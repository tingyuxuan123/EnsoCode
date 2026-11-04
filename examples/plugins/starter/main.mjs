/** @type {import('./enso-plugin').PluginActivate} */
export const activate = (enso) => {
  enso.renderer.handle('greeting', () => '你好，EnsoCode！');
};
