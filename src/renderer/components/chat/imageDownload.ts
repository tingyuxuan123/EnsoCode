/** Download the original image through the existing media URL, never a new Main path IPC. */
export async function downloadImage(src: string, fileName: string): Promise<void> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Could not load image (${response.status})`);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  try {
    document.body.append(link);
    link.click();
  } finally {
    link.remove();
    // Let the browser consume the blob before revoking it (including Electron downloads).
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
