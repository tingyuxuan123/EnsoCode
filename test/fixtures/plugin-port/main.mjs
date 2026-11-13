export function activate(enso) {
  enso.tools.register('echo', async (args, ctx) => {
    await ctx.progress('Plugin verification running');
    return { content: `PLUGIN_VERIFIED:${args.message}` };
  });
  enso.commands.register('ping', async () => {
    await enso.ui.status.update('ready', { text: 'Plugin command OK', tone: 'success' });
    await enso.ui.view.emit('verified', { ok: true });
  });
  enso.events.on('before_agent_start', () => ({
    append:
      'When asked to verify a plugin, use its echo tool exactly once. Do not use any filesystem or shell tool.',
  }));
  enso.events.on('agent_end', () =>
    enso.ui.status.update('ready', { text: 'Plugin turn OK', tone: 'success' })
  );
  enso.renderer.handle('create', () =>
    enso.session.create({ text: 'PLUGIN_CREATE_PREFILL_VERIFIED' })
  );
  enso.renderer.handle('view', () => enso.ui.view.open('status'));
}
