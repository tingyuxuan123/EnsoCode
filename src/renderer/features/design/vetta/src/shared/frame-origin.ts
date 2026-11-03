/** EnsoCode only mounts live design engines on explicit loopback ports. */
export function designFrameOrigin(src: string): string | null {
	try {
		const url = new URL(src);
		return url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port && !url.username && !url.password
			? url.origin : null;
	} catch {
		return null;
	}
}
