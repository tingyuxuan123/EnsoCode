import { createController } from './lib/controller.mjs';

export function activate(enso) {
  const controller = createController(enso);
  const methods = [
    'state',
    'load',
    'send_task',
    'save_simple_report',
    'connect',
    'calibrate',
    'test_write',
    'sync',
    'prepare_claim',
    'confirm',
    'reconcile',
    'save_report',
    'prepare_delivery',
    'open_view',
    'insert_draft',
  ];
  const disposers = methods.map((method) =>
    enso.renderer.handle(method, (args, ctx) => controller.call(method, args ?? {}, ctx))
  );
  disposers.push(
    enso.tools.register('get_task', async (_args, ctx) => ({
      content: JSON.stringify(await controller.getTask(ctx)),
    }))
  );
  disposers.push(
    enso.tools.register('build_report', async (args, ctx) => ({
      content: JSON.stringify(await controller.report(args, ctx)),
    }))
  );
  return () => {
    for (const dispose of disposers.reverse()) if (typeof dispose === 'function') dispose();
  };
}
