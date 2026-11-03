import { expect, it, vi } from 'vitest';
import { toVettaFileUrl } from '../src/cards/file-url';
it('reads binary through the SDK and owns an idempotently released blob URL', async () => {
  const readBinaryFile = vi.fn(async () => ({ data: 'AQI=', mimeType: 'image/png', size: 2 }));
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:design');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const image = await toVettaFileUrl('/work/a.vetd/.snapshots/1.png', { readBinaryFile });
  expect(readBinaryFile).toHaveBeenCalledWith('/work/a.vetd/.snapshots/1.png');
  expect(create.mock.calls[0][0]).toMatchObject({ type: 'image/png', size: 2 });
  expect(image.url).toBe('blob:design');
  image.dispose(); image.dispose();
  expect(revoke.mock.calls).toEqual([['blob:design']]);
  vi.restoreAllMocks();
});
it('does not produce URLs for failed reads or non-image content', async () => {
  await expect(toVettaFileUrl('/bad', { readBinaryFile: async () => { throw new Error('denied'); } })).rejects.toThrow('denied');
  await expect(toVettaFileUrl('/bad', { readBinaryFile: async () => ({ data: 'AA==', mimeType: 'text/html', size: 1 }) })).rejects.toThrow();
});
