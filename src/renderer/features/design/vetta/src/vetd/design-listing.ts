/** 顶栏只订阅当前会话已发现的设计包，不在渲染期重复扫描。 */
interface DesignListing {
	sessionId: string;
	cwd: string;
	paths: readonly string[];
}
let listing: DesignListing | null = null;
const listeners = new Set<() => void>();

export function getDesignListing(): DesignListing | null {
	return listing;
}

export function subscribeDesignListing(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

export function publishDesignListing(next: DesignListing | null): void {
	listing = next;
	for (const listener of listeners) listener();
}

/** 应用显式创建、导入或打开的稿件不必等下一次切会话才出现在顶栏。 */
export function addDesignToListing(cwd: string, path: string): void {
	if (listing?.cwd !== cwd || listing.paths.includes(path)) return;
	publishDesignListing({ ...listing, paths: [...listing.paths, path].sort() });
}
