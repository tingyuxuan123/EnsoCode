// The engine template ships inside the plugin bundle as raw text and is
// materialized to ~/.vetta/design-engine/<version>/ at runtime (plugin fs.write
// is project-scoped, so materialization goes through a `node -e` bootstrap).
import engineIndexHtml from "@design-engine/index.html?raw";
import enginePackageJson from "@design-engine/package.json?raw";
import enginePackageLockJson from "@design-engine/package-lock.json?raw";
import engineBridge from "@design-engine/src/bridge.ts?raw";
import engineIosStatusBar from "@design-engine/src/ios/StatusBar.tsx?raw";
import engineMain from "@design-engine/src/main.tsx?raw";
import enginePreloadable from "@design-engine/src/preloadable.tsx?raw";
import engineRoundFrame from "@design-engine/src/round-frame.ts?raw";
import engineRoutes from "@design-engine/src/routes.ts?raw";
import engineStatusBarProbe from "@design-engine/src/status-bar-probe.ts?raw";
import engineStorageSync from "@design-engine/src/storage-sync.ts?raw";
import engineStyles from "@design-engine/src/styles.css?raw";
import engineTouch from "@design-engine/src/touch.ts?raw";
import engineTouchGesture from "@design-engine/src/touch-gesture.ts?raw";
import engineViteConfig from "@design-engine/vite.config.mjs?raw";

/** relPath (inside the engine root) → file content. */
export const ENGINE_FILES: Record<string, string> = {
	"package.json": enginePackageJson,
	// 与 package.json 一起 materialize，安装才能走 `npm ci`（见 engine-manager
	// 的 installDependencies）：省掉 ~190 个包的范围解析往返。lock 里的 resolved
	// 主机不会架空镜像——npm 按当前 registry 配置改写下载主机。
	"package-lock.json": enginePackageLockJson,
	"vite.config.mjs": engineViteConfig,
	"index.html": engineIndexHtml,
	"src/main.tsx": engineMain,
	"src/ios/StatusBar.tsx": engineIosStatusBar,
	"src/preloadable.tsx": enginePreloadable,
	"src/bridge.ts": engineBridge,
	"src/round-frame.ts": engineRoundFrame,
	"src/routes.ts": engineRoutes,
	"src/status-bar-probe.ts": engineStatusBarProbe,
	"src/storage-sync.ts": engineStorageSync,
	"src/styles.css": engineStyles,
	"src/touch.ts": engineTouch,
	"src/touch-gesture.ts": engineTouchGesture,
};

/**
 * 引擎自带、设计源码可以直接 import 的包。
 *
 * 这是 vite.config.mjs 里那组 alias 的另一半事实：这些包装在**引擎**的
 * node_modules 里，设计源码走 node 解析够不到，靠 alias 钉过去。设计自己装的包
 * 不在这张表里——那些在 `x.vetd/node_modules/`，天然就能解析（ADR-0068）。
 */
export const ENGINE_PROVIDED_PACKAGES = ["react", "react-dom", "react-router", "lucide-react", "@vetta/ios"] as const;

/**
 * 新建设计时写进 `x.vetd/package.json` 的运行时依赖版本。
 *
 * 从引擎 package.json 现取而不是再抄一份：两处各写一份，引擎升级 react 的那天
 * 就会对不上，而症状是第三方库的 peer 校验开始报警告，很难联想到这里。
 */
export function engineRuntimeDependencies(): Record<string, string> {
	const parsed = JSON.parse(enginePackageJson) as { dependencies?: Record<string, string> };
	const declared = parsed.dependencies ?? {};
	const runtime: Record<string, string> = {};
	// lucide-react 不进去：它是图标的兜底路径（见 vite.config.mjs 的 alias 注释），
	// 由引擎 alias 接住，不该出现在用户设计的依赖清单里。
	for (const name of ["react", "react-dom", "react-router"]) {
		const version = declared[name];
		if (version) runtime[name] = version;
	}
	return runtime;
}

/** Stable content hash so a plugin update re-materializes changed templates. */
export function engineFilesHash(): string {
	let hash = 5381;
	for (const key of Object.keys(ENGINE_FILES).sort()) {
		const text = `${key}\0${ENGINE_FILES[key]}`;
		for (let i = 0; i < text.length; i++) {
			hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
		}
	}
	return (hash >>> 0).toString(36);
}
