/**
 * Windows 上引擎物化在 C:（userData），设计稿常在别的盘。vite 的 import.meta.glob
 * 把引擎 root 之外的命中写成相对 importer 的路径，跨盘时没有相对路径可言，就拼出
 * `../../…/E:/x.tsx` 这种 import 分析解析不了的东西：入口编译失败，所有 frame 白屏。
 *
 * 把这种「一串 ../ 之后跟盘符」的字符串改回盘符绝对路径。dev 下 vite 的解析器认
 * 盘符绝对路径（再转成 /@fs/），构建时 rollup 也认；同盘的相对路径不受影响。
 */
export function absolutizeCrossDriveImports(code: string): string {
	return code.replace(/(["'`])(?:\.\.\/)+([A-Za-z]:\/)/g, "$1$2");
}

/** 设计稿会直接引用的静态文件：图片、字体、音视频。脚本与样式仍走 vite 的转换。 */
const STATIC_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avif: "image/avif",
	svg: "image/svg+xml",
	ico: "image/x-icon",
	woff: "font/woff",
	woff2: "font/woff2",
	ttf: "font/ttf",
	otf: "font/otf",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	mp4: "video/mp4",
	webm: "video/webm",
	pdf: "application/pdf",
};

function extensionOf(path: string): string {
	const dot = path.lastIndexOf(".");
	return dot < 0 ? "" : path.slice(dot + 1).toLowerCase();
}

export function contentTypeOf(path: string): string {
	return STATIC_TYPES[extensionOf(path)] ?? "application/octet-stream";
}

/**
 * vite 在 Windows 上提供 `/@fs/E:/…` 的原始文件时去掉盘符，从进程所在盘的根去找；
 * 引擎在 C:、设计在 E: 时就找错盘，落到 index.html。这里认出这种请求，返回
 * 文件的盘符绝对路径（未做访问校验，调用方负责）；同盘、模块请求或非静态文件返回 null。
 */
export function crossDriveFsPath(url: string, cwdDrive: string | null): string | null {
	if (!cwdDrive || !url.startsWith("/@fs/")) return null;
	const [pathPart, query = ""] = url.split("#")[0].split("?");
	if (/(?:^|&)(?:import|raw|url|inline|worker|direct)(?:[=&]|$)/.test(query)) return null;
	let path: string;
	try {
		path = decodeURIComponent(pathPart.slice("/@fs/".length));
	} catch {
		return null;
	}
	const drive = /^([A-Za-z]):\//.exec(path);
	if (!drive || drive[1].toUpperCase() === cwdDrive.toUpperCase()) return null;
	if (!(extensionOf(path) in STATIC_TYPES)) return null;
	return path;
}
