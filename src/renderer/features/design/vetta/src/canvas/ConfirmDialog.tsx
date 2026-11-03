import { Dialog, DialogHeader, DialogDescription, DialogFooter, DialogPopup, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DesignRoot } from "../../../mounts/DesignRoot";

interface ConfirmDialogProps {
	title: string;
	description: string;
	confirmLabel: string;
	cancelLabel: string;
	/** 危险动作用红色确认按钮（删除）。 */
	danger?: boolean;
	onConfirm(): void;
	onCancel(): void;
}

/**
 * 画布与画廊的二次确认框；宿主负责模态层级、焦点与 Escape。
 */
export function ConfirmDialog({
	title,
	description,
	confirmLabel,
	cancelLabel,
	danger,
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	return (
		<Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
			<DialogPopup className="max-w-sm" bottomStickOnMobile={false}>
				<DesignRoot>
					<DialogHeader>
						<DialogTitle>{title}</DialogTitle>
						<DialogDescription>{description}</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" size="sm" onClick={onCancel}>{cancelLabel}</Button>
						<Button variant={danger ? "destructive" : "default"} size="sm" onClick={onConfirm}>{confirmLabel}</Button>
					</DialogFooter>
				</DesignRoot>
			</DialogPopup>
		</Dialog>
	);
}
