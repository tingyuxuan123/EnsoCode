import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export function activate(enso) {
  const file = join(enso.dataDir, 'note.txt');
  enso.renderer.handle('read', async () => {
    try {
      return await readFile(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return '';
      throw error;
    }
  });
  enso.renderer.handle('save', async (args) => {
    if (typeof args?.text !== 'string' || args.text.length > 8000)
      throw new Error('Note must be at most 8000 characters');
    await mkdir(enso.dataDir, { recursive: true });
    const temporary = `${file}.tmp`;
    await writeFile(temporary, args.text, { mode: 0o600 });
    await rename(temporary, file);
    return { saved: true };
  });
}
