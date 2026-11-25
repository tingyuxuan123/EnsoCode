// Adapter for the pinned 3.6.0 package. Its bin calls process.exit immediately after write(),
// which truncates large JSON on pipes. Use the same runCli and drain stdout before natural exit.
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

try {
  const [entry, ...args] = process.argv.slice(2);
  const { runCli } = await import(pathToFileURL(join(dirname(entry), '..', 'cli.js')).href);
  const result = await runCli(args, process.cwd(), '');
  if (result.stdout) {
    await new Promise((resolve, reject) => {
      process.stdout.write(`${result.stdout}\n`, (error) => (error ? reject(error) : resolve()));
    });
  }
  process.exitCode = result.exitCode;
} catch (error) {
  process.stderr.write(`llmdoc: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 70;
}
