import { sourceDesignFile } from "@shared/design/sourceBundle";
import type { PluginFsApi, PluginFsFileRef } from "@vetta-org/plugin-sdk";
import { MANIFEST_FILE } from "./manifest-types";
import { migrateLegacyDesign } from "./migrate";

/** 一次扫描的结果：已是 v2 的设计包，以及还需要迁移的 v1 遗留条目。 */
export interface DiscoveredDesigns {
	/** `x.vetd/` 目录路径。 */
	bundles: string[];
	/** 仍是文件形态的 `x.vetd`：可能是 v1 工作态，也可能是打包分享文件。 */
	legacyFiles: string[];
}

const BUNDLE_MANIFEST_SUFFIX = `.vetd/${MANIFEST_FILE}`;
/**
 * v1 旁挂目录里出现 manifest，只可能是上一次迁移停在了「manifest 已复制进旁挂目录」
 * 之后。若此时 `x.vetd` 文件也已删掉（第 2 步做完、第 3 步没做），磁盘上就再没有任何
 * 叫 `.vetd` 的条目了——只按 `.vetd` 找设计的扫描会彻底看不见它。
 */
const LEGACY_SIDECAR_MANIFEST_SUFFIX = `.vetd.d/${MANIFEST_FILE}`;

/** 这个路径是否落在某个设计包内部（bundle 或 v1 旁挂目录）。 */
function insideDesign(relPath: string): boolean {
	return relPath.includes(".vetd/") || relPath.includes(".vetd.d/");
}

/**
 * 从递归文件列表里认出设计。宿主的递归列举只回文件，所以设计包这个**目录**靠它
 * 里面的 design.json 反推。无 manifest 但 theme + 真实 frame 尚在的源码包也可打开，
 * 由 DesignSession 原有的 reconcile 恢复 manifest；扫描阶段不写文件。
 */
export function pickDesignPaths(files: PluginFsFileRef[]): DiscoveredDesigns {
	const bundles = new Set<string>();
	const themes = new Set<string>();
	const frames = new Set<string>();
	const legacyFiles: string[] = [];
	/** 落单的旁挂目录推出来的 `x.vetd`，等确认没有同名条目后才算数。 */
	const orphanSidecars: string[] = [];
	for (const file of files) {
		const rel = file.relPath.replaceAll("\\", "/");
		const path = file.path.replaceAll("\\", "/");
		// Only the outermost design is a candidate; embedded examples/assets are its content.
		const source = sourceDesignFile(rel);
		if (source) {
			const dir = path.slice(0, path.length - (rel.length - source.bundle.length));
			(source.kind === "theme" ? themes : frames).add(dir);
		}
		if (rel.endsWith(BUNDLE_MANIFEST_SUFFIX)) {
			const parent = rel.slice(0, -`/${MANIFEST_FILE}`.length);
			if (!insideDesign(parent)) bundles.add(path.slice(0, -`/${MANIFEST_FILE}`.length));
			continue;
		}
		if (rel.endsWith(LEGACY_SIDECAR_MANIFEST_SUFFIX)) {
			// `…/x.vetd.d/design.json` → `…/x.vetd`
			const parent = rel.slice(0, -`.d/${MANIFEST_FILE}`.length);
			if (!insideDesign(parent)) orphanSidecars.push(path.slice(0, path.length - `.d/${MANIFEST_FILE}`.length));
			continue;
		}
		// 包内部的东西都是设计内容，不会自己又是一份设计。
		if (insideDesign(rel)) continue;
		if (file.name.endsWith(".vetd")) legacyFiles.push(file.path);
	}
	for (const dir of themes) if (frames.has(dir)) bundles.add(dir);
	// 同名的设计包或 v1 文件还在，说明迁移没停在那个窗口里，旁挂目录交给正常路径处理。
	const claimed = new Set([...bundles, ...legacyFiles.map((path) => path.replaceAll("\\", "/"))]);
	for (const path of orphanSidecars) {
		if (!claimed.has(path)) legacyFiles.push(path);
	}
	return { bundles: [...bundles].sort(), legacyFiles: [...new Set(legacyFiles)].sort() };
}

/**
 * 扫出 scope 下所有设计包，顺带把遇到的 v1 遗留形态就地迁移（幂等，见
 * {@link migrateLegacyDesign}）。迁移失败的条目按「不是设计」处理——打包分享
 * 文件也叫 `.vetd`，它本来就不该出现在画布的设计列表里。
 */
export async function findVetdFiles(fs: PluginFsApi, cwd: string): Promise<string[]> {
	let picked: DiscoveredDesigns;
	try {
		picked = pickDesignPaths(await fs.listFilesRecursive(cwd));
	} catch {
		return [];
	}
	const found = [...picked.bundles];
	for (const legacy of picked.legacyFiles) {
		const migrated = await migrateLegacyDesign(fs, legacy).catch(() => false);
		if (migrated) found.push(legacy);
	}
	return found.sort();
}

/**
 * 根目录下允许与设计稿共存、仍算「纯设计项目」的元文件。宿主的递归列举跳过
 * 隐藏项（`.git`、`.vetta` 等）和 node_modules/dist 之类，但设计包（`x.vetd/`）
 * 不是隐藏目录，其内容会被列出来，判定时单独豁免；这里只需要放过人和
 * Agent 顺手留下的说明文件。
 */
const PURE_PROJECT_META_FILES = new Set(["readme.md", "readme", "license", "license.md", "agents.md", "claude.md"]);

/**
 * 设计参考资料目录（风格库开新设计时落的 DESIGN.md / theme.css）。它是为这份设计准备
 * 的素材，不是「别的实质文件」——不豁免的话，从风格库开的项目会因为多了这个目录而被
 * 判成非纯设计项目，画布不再自动展开。
 */
const DESIGN_RESOURCES_PREFIX = "design-resources/";

/**
 * 纯设计项目：至少有一份设计稿，且没有别的实质文件。判定放在纯函数里，
 * 因为「自动打开设计面板」是会打断用户的副作用，误判代价比漏判高。
 */
export function isPureDesignProject(files: PluginFsFileRef[]): boolean {
	let hasVetd = false;
	for (const file of files) {
		const rel = file.relPath.replaceAll("\\", "/");
		// 设计包内部（frames/theme/assets 等）是设计稿的一部分，不影响判定。
		if (insideDesign(rel)) {
			if (rel.endsWith(BUNDLE_MANIFEST_SUFFIX)) hasVetd = true;
			continue;
		}
		if (file.name.endsWith(".vetd")) {
			hasVetd = true;
			continue;
		}
		if (rel.startsWith(DESIGN_RESOURCES_PREFIX)) continue;
		const isRootLevel = !rel.includes("/");
		if (isRootLevel && PURE_PROJECT_META_FILES.has(file.name.toLowerCase())) continue;
		return false;
	}
	return hasVetd;
}
