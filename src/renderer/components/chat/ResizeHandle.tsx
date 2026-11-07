import { GripVertical } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface ResizeHandleProps {
  onResize: (deltaX: number) => void;
  /** 拖拽开始/结束通知(消费方可借此暂停宽度动画,避免 spring 追赶抖动) */
  onResizingChange?: (resizing: boolean) => void;
}

/** 侧边栏缘的拖拽手柄:视觉 1px,命中区左右各扩 4px,中段悬停时浮出抓握点 */
export function ResizeHandle({ onResize, onResizingChange }: ResizeHandleProps) {
  const [resizing, setResizing] = useState(false);
  const lastX = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setResizing(true);
      onResizingChange?.(true);
      lastX.current = e.clientX;
      // 指针一离开 1px 分隔线就会落回本行元素的默认光标,拖到一半就“看不到拖动光标”了;
      // 整段拖动期间把列宽光标钉在 body 上,松手还原。
      const bodyStyle = document.body.style;
      const previousCursor = bodyStyle.cursor;
      const previousUserSelect = bodyStyle.userSelect;
      bodyStyle.cursor = 'col-resize';
      bodyStyle.userSelect = 'none';
      const handleMove = (ev: MouseEvent) => {
        onResize(ev.clientX - lastX.current);
        lastX.current = ev.clientX;
      };
      const handleUp = () => {
        setResizing(false);
        onResizingChange?.(false);
        bodyStyle.cursor = previousCursor;
        bodyStyle.userSelect = previousUserSelect;
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
      };
      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
    },
    [onResize, onResizingChange]
  );

  return (
    <div className="group relative w-px shrink-0 bg-transparent">
      <div
        data-slot="resize-hit"
        onMouseDown={handleMouseDown}
        className={cn(
          '-left-1 -right-1 absolute inset-y-0 z-10 cursor-col-resize',
          'after:absolute after:inset-y-0 after:left-1 after:w-px after:transition-colors hover:after:bg-ring',
          resizing && 'after:bg-ring'
        )}
      />
      {/* 抓握点:悬停/拖动时在分隔线中段浮出,补上「这里能左右拖」的可见落点 */}
      <div
        data-slot="resize-grip"
        data-active={resizing}
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2',
          'text-faint opacity-0 transition-opacity group-hover:opacity-100',
          resizing && 'text-ring opacity-100'
        )}
      >
        <GripVertical className="size-3.5" />
      </div>
    </div>
  );
}
