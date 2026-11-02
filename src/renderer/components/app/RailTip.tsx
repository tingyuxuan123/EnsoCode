import type { ReactElement } from 'react';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * 图标轨按钮的右侧悬浮提示：图标不带文字，名称和快捷键放进气泡。
 * 按钮自身应带 aria-label，气泡只做视觉提示。
 */
export function RailTip({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string;
  children: ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipPopup
        side="right"
        sideOffset={10}
        className="rounded-lg text-[13px] shadow-md [--viewport-inline-padding:10px]"
      >
        <span className="flex items-center gap-2 py-0.5">
          {label}
          {shortcut && <span className="text-[12px] text-muted-foreground">{shortcut}</span>}
        </span>
      </TooltipPopup>
    </Tooltip>
  );
}
