/** This fixture intentionally uses only the public plugin API. */
export function activate(enso) {
  let current = null;
  let controller;
  enso.renderer.handle('start', (args) => {
    if (current?.state === 'running') throw new Error('Verification already running');
    if (typeof args?.prompt !== 'string') throw new Error('prompt required');
    controller = new AbortController();
    const result = { state: 'running', events: [] };
    current = result;
    void enso.agent
      .run({
        prompt: args.prompt,
        context: args.context ?? 'none',
        timeoutMs: 120000,
        signal: controller.signal,
        onEvent: (event) => result.events.push(event),
      })
      .then(
        (value) => Object.assign(result, { state: 'completed', value }),
        (error) =>
          Object.assign(result, { state: 'failed', error: error.message, code: error.code })
      );
    return { started: true };
  });
  enso.renderer.handle('result', () => current);
  enso.renderer.handle('cancel', () => {
    controller?.abort();
    return { cancelled: true };
  });
  enso.renderer.handle('open', () => enso.ui.view.open('proof'));
  enso.renderer.handle('close', () => enso.ui.view.close('proof'));
  return () => controller?.abort();
}
