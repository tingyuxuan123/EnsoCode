/** Map an absolute local path to the privileged vetta-file:// scheme (ADR-0027). */
export function toVettaFileUrl(path: string): string {
 // This synchronous legacy API cannot perform a safe binary IPC read. P2 card
 // mounts must load via ctx.fs.readBinaryFile and use a data/blob URL instead.
 throw new Error(`EnsoCode P1 file image preview is not mounted: ${path}`);
}
