import { runPluginHost } from './host';

// Electron utilityProcess transport. Deliberately no Electron app imports here.
const parent = process.parentPort;
if (!parent) throw new Error('Plugin host requires an Electron utilityProcess parentPort');
runPluginHost({
  send: (message) => parent.postMessage(message),
  onMessage: (handler) => parent.on('message', (event) => handler(event.data)),
});
