import type { PluginPreviewFile } from "@vetta-org/plugin-sdk";
import { useTranslation } from "@vetta-org/plugin-sdk";
import { useEffect, useState } from "react";
import { parsePackagedVetd, parseDesignManifest, type PackagedVetd } from "../export/import-design";
import { notify } from "../plugin-context";
import type { DesignPreviewActions } from "../../../host/preview-files";
import { ConfirmDialog } from "@/components/chat/ConfirmDialog";
import { PreviewCanvas } from "./PreviewCanvas";
import { inlineSnapshotAssets } from "./snapshot-assets";
import type { VetdManifest } from "../vetd/manifest-types";

type PreviewState =
	| { kind: "loading" }
	| { kind: "invalid" }
	| { kind: "working"; manifest: VetdManifest }
	/** `snapshotHtml` 是已经把包内资源内嵌进去的版本，见 snapshot-assets。 */
	| { kind: "packaged"; manifest: VetdManifest; packaged: PackagedVetd; snapshotHtml: string | null };

function parseManifest(json: string): VetdManifest | null {
	try {
		return parseDesignManifest(json);
	} catch {
		// fallthrough
	}
	return null;
}

export function VetdPreview({ file, actions }: { file: PluginPreviewFile; actions?: DesignPreviewActions }) {
	const { t, locale } = useTranslation();
	const [state, setState] = useState<PreviewState>({ kind: "loading" });
	const [confirmImport, setConfirmImport] = useState(false);
	const [importing, setImporting] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setState({ kind: "loading" });
		const load = async (): Promise<void> => {
			if (file.size > 32 * 1024 * 1024) throw new Error("Design preview exceeds size limit");
			const bytes = new Uint8Array(await file.readBytes());
			if (bytes.length > 32 * 1024 * 1024) throw new Error("Design preview exceeds size limit");
			if (!bytes) {
				setState({ kind: "invalid" });
				return;
			}
			// zip sniff: PK\x03\x04
			if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
				const packaged = parsePackagedVetd(bytes);
				const manifest = parseManifest(packaged.manifestJson);
				if (!manifest) {
					setState({ kind: "invalid" });
					return;
				}
				// 图片在包里但快照引用的是构建产物路径（srcdoc 下解析不到），这里补上。
				const snapshotHtml = packaged.snapshotHtml
					? await inlineSnapshotAssets(packaged.snapshotHtml, packaged.designFiles, { decodeRaster: false })
					: null;
				if (cancelled) return;
				setState({ kind: "packaged", manifest, packaged, snapshotHtml });
				return;
			}
			const manifest = parseManifest(new TextDecoder().decode(bytes));
			if (!cancelled) setState(manifest && file.extension === "vetd" ? { kind: "working", manifest } : { kind: "invalid" });
		};
		load().catch((error: unknown) => {
			if (cancelled) return;
			setState({ kind: "invalid" });
			notify({ message: t("preview.invalid"), error });
		});
		return () => {
			cancelled = true;
		};
	}, [file, t]);

	const openCanvas = (): void => {
		void actions?.openCanvas().catch((error) => notify({ message: t("canvas.import.failed"), error }));
	};

	const runImport = async (packaged: PackagedVetd): Promise<void> => {
		if (!actions || importing) return;
		setImporting(true);
		try {
			const vetdPath = await actions.importPackage(packaged);
			notify({ message: t("canvas.import.done", { path: vetdPath }), variant: "success", durationMs: 5000 });
		} catch (error) {
			notify({ message: t("canvas.import.failed"), error });
		} finally {
			setImporting(false);
		}
	};

	if (state.kind === "loading") {
		return (
			<div className="flex h-full items-center justify-center">
				<span className="size-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
			</div>
		);
	}
	if (state.kind === "invalid") {
		return (
			<div className="flex h-full items-center justify-center text-xs text-muted-foreground">
				{t("preview.invalid")}
			</div>
		);
	}

	const badge = state.kind === "packaged" ? t("preview.packaged.badge") : t("preview.working.badge");
	return (
		<div className="relative flex h-full min-h-0 flex-col gap-2 p-3">
			<div className="flex items-center gap-2">
				<span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
					{badge}
				</span>
				<span className="text-xs text-muted-foreground">
					{t("preview.frames.count", { count: state.manifest.frames.length })}
				</span>
				<span className="flex-1" />
				{state.kind === "working" ? (
					<button
						type="button"
						onClick={openCanvas}
						disabled={!actions}
						className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
					>
						{t("preview.open")}
					</button>
				) : (
					<button
						type="button"
						onClick={() => setConfirmImport(true)}
						disabled={!actions || importing}
						className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
					>
						{t("preview.import")}
					</button>
				)}
			</div>
			<ConfirmDialog
				open={confirmImport}
				onOpenChange={setConfirmImport}
				title={t("preview.import")}
				description={locale === "zh" ? "导入后将在设计画布中运行包内代码，设计及 npm 依赖可以执行本机代码。仅导入可信来源；只读预览不会授予这些权限。是否继续？" : "Importing opens executable design code on the canvas. The design and npm dependencies can execute local code. Only import trusted sources; read-only preview does not grant these permissions. Continue?"}
				confirmLabel={t("preview.import")}
				onConfirm={() => { setConfirmImport(false); if (state.kind === "packaged") void runImport(state.packaged); }}
			/>
			{state.kind === "packaged" && !state.snapshotHtml ? (
				<p className="text-xs text-muted-foreground">{t("preview.snapshot.missing")}</p>
			) : null}
			{/* 只读画布：与设计面板同一套平移/缩放（见 canvas/use-viewport），
			    但不带选中、拖拽与编辑——分享包在预览里不可改。 */}
			<div className="min-h-0 flex-1 overflow-hidden rounded-lg">
				<PreviewCanvas
					manifest={state.manifest}
					snapshotHtml={state.kind === "packaged" ? state.snapshotHtml : null}
				/>
			</div>
		</div>
	);
}
