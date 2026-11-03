import type { PluginFsApi } from "@vetta-org/plugin-sdk";

/** EnsoCode has no privileged file protocol; every URL owns a checked IPC read. */
export async function toVettaFileUrl(path: string, fs: Pick<PluginFsApi, "readBinaryFile">): Promise<{ url: string; dispose(): void }> {
 const result = await fs.readBinaryFile(path);
 if (!/^image\/(png|jpeg|webp|gif|avif|svg\+xml)$/.test(result.mimeType)) throw new Error("Unsupported screenshot MIME type");
 const bytes = Uint8Array.from(atob(result.data), (value) => value.charCodeAt(0));
 const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
 let disposed = false;
 return { url, dispose() { if (!disposed) { disposed = true; URL.revokeObjectURL(url); } } };
}
