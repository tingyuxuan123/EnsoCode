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
