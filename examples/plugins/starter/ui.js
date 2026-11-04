/** @type {import('./enso-plugin').PluginOnLoad} */
export const onLoad = (enso) => {
  const { composer, React } = enso;
  if (!composer) return;

  const insert = async () => {
    const snapshot = await composer.readDraft();
    const text = await enso.dispatch('plugin.call', { method: 'greeting' });
    if (typeof text === 'string') await composer.insertText({ text, expect: snapshot });
  };

  return enso.slots.register({
    slot: 'composer.right',
    component: ({ busy }) =>
      React.createElement(
        'button',
        {
          type: 'button',
          disabled: busy,
          onClick: () =>
            void insert().catch((error) => console.warn('[plugin] insert failed', error)),
        },
        '插入问候'
      ),
  });
};
