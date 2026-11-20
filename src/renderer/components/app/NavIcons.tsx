export interface NavIconProps {
  className?: string;
  active?: boolean;
}

/**
 * Code 主工作区图标：开放式 `</>` 几何字符，打破图标轨的连续方框堆叠。
 */
export function CodeWorkspaceIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-rail-glyph="code"
      className={className}
    >
      <path d="m7.75 8.25-4 3.75 4 3.75" />
      <path d="m16.25 8.25 4 3.75-4 3.75" />
      <path d="m13.75 6.25-3.5 11.5" />
    </svg>
  );
}

/**
 * 图片工作台图标：右上角破框嵌入四芒星，与正文附件的通用相册图标区分。
 */
export function ImageStudioIcon({ className, active = false }: NavIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-rail-glyph="images"
      className={className}
    >
      {active && (
        <rect
          data-active-fill=""
          x="4"
          y="4"
          width="16"
          height="16"
          rx="3.25"
          fill="currentColor"
          fillOpacity={0.14}
          stroke="none"
        />
      )}
      <path d="M12.5 4H7.25A3.25 3.25 0 0 0 4 7.25v9.5A3.25 3.25 0 0 0 7.25 20h9.5A3.25 3.25 0 0 0 20 16.75V11.5" />
      <path d="M4.25 16.4c2.7-3 5.55-3 8-.55 1.85 1.85 3.9 1.6 7.45-1.35" />
      <path
        data-spark=""
        d="M18.15 2.35c.38 2.15 1.1 2.87 3.25 3.25-2.15.38-2.87 1.1-3.25 3.25-.38-2.15-1.1-2.87-3.25-3.25 2.15-.38 2.87-1.1 3.25-3.25Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

/**
 * 设计画廊图标：方圆基础几何叠加并留出清晰间隙，替代斜向刻度直尺。
 */
export function DesignGalleryIcon({ className, active = false }: NavIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-rail-glyph="design"
      className={className}
    >
      {active && (
        <circle
          data-active-fill=""
          cx="15"
          cy="15"
          r="5.35"
          fill="currentColor"
          fillOpacity={0.16}
          stroke="none"
        />
      )}
      <path d="M7.6 15H6.25A2.75 2.75 0 0 1 3.5 12.25v-6A2.75 2.75 0 0 1 6.25 3.5h6A2.75 2.75 0 0 1 15 6.25V7.6" />
      <circle cx="15" cy="15" r="5.35" />
    </svg>
  );
}

/**
 * 扩展入口图标：2×2 模块化方块与轻旋置入的右上角单元，保持与侧栏圆圈图标一致的视觉体量。
 */
export function ExtensionsIcon({ className, active = false }: NavIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-nav-glyph="extensions"
      className={className}
    >
      <rect x="3.5" y="4.25" width="6.75" height="6.75" rx="1.65" />
      <rect x="3.5" y="13.75" width="6.75" height="6.75" rx="1.65" />
      <rect x="13" y="13.75" width="6.75" height="6.75" rx="1.65" />
      {active && (
        <rect
          data-active-fill=""
          x="14.1"
          y="2.9"
          width="6.5"
          height="6.5"
          rx="1.6"
          transform="rotate(14 17.35 6.15)"
          fill="currentColor"
          fillOpacity={0.16}
          stroke="none"
        />
      )}
      <rect x="14.1" y="2.9" width="6.5" height="6.5" rx="1.6" transform="rotate(14 17.35 6.15)" />
    </svg>
  );
}
