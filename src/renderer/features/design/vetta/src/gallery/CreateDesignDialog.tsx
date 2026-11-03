import { useTranslation } from "@vetta-org/plugin-sdk";
import { useId, useState } from "react";
import { Dialog, DialogHeader, DialogPanel, DialogFooter, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { DesignRoot } from "../../../mounts/DesignRoot";
import { toProjectName } from "./gallery-actions";

interface CreateDesignDialogProps {
	/** 新项目会建在哪儿，直接显示给用户看，省得建完不知道东西去了哪。 */
	workspacePath: string;
	busy: boolean;
	/** 从风格库进来时带上体系名：用户刚点的是风格，得让他确认自己在给什么起名。 */
	styleName?: string;
	onCreate(name: string): void;
	onClose(): void;
}

/** 新建设计稿：只问一个名字，落点固定在 workspace 下。 */
export function CreateDesignDialog({ workspacePath, busy, styleName, onCreate, onClose }: CreateDesignDialogProps) {
	const { t } = useTranslation();
	const [name, setName] = useState("");
	const formId = useId();
	const normalized = toProjectName(name);
	// 清洗后为空（全是分隔符之类）就不给建，否则会落成一个叫 "design" 的意外项目。
	const canSubmit = !busy && name.trim().length > 0 && normalized.length > 0;

	return (
		<Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
			<DialogPopup className="max-w-sm" bottomStickOnMobile={false}>
				<DesignRoot>
					<DialogHeader>
						<DialogTitle>
							{styleName ? t("gallery.create.withStyle", { name: styleName }) : t("gallery.create.title")}
						</DialogTitle>
					</DialogHeader>
					<DialogPanel>
						<form
							id={formId}
							onSubmit={(event) => {
								event.preventDefault();
								if (canSubmit) onCreate(normalized);
							}}
						>
							<input
								// biome-ignore lint/a11y/noAutofocus: 对话框只有这一个输入框，打开就该能直接敲
								autoFocus
								value={name}
								onChange={(event) => setName(event.target.value)}
								placeholder={t("gallery.create.placeholder")}
								aria-label={t("gallery.create.title")}
								className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground outline-none focus:border-primary"
							/>
							<p className="mt-2 truncate text-[11px] text-muted-foreground" title={workspacePath}>
								{t("gallery.create.location", { path: `${workspacePath}/${normalized || "…"}` })}
							</p>
						</form>
					</DialogPanel>
					<DialogFooter>
						<button
							type="button"
							onClick={onClose}
							className="rounded-lg px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent"
						>
							{t("gallery.action.cancel")}
							</button>
						<button
							type="submit"
							form={formId}
							disabled={!canSubmit}
							className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-40"
						>
							{busy ? t("gallery.create.busy") : t("gallery.create.confirm")}
						</button>
					</DialogFooter>
				</DesignRoot>
			</DialogPopup>
		</Dialog>
	);
}
