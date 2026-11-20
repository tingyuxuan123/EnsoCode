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

/**
 * Ask CodeKiln 专属入口微标：Enso 缺口圆环 + 中心星核与弧尾星点，
 * 呼应运行状态中的轨道彗星语言，在 14px 标题栏按钮与 19px 图标轨均保持清晰轮廓。
 */
export function AskCodeKilnIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-nav-glyph="ask-codekiln"
      className={className}
    >
      <path d="M19.85 10.35A8.25 8.25 0 1 1 13.65 4.15" />
      <circle cx="18.35" cy="5.65" r="1.2" fill="currentColor" stroke="none" />
      <path
        d="M12 7c.52 2.9 2.1 4.48 5 5-2.9.52-4.48 2.1-5 5-.52-2.9-2.1-4.48-5-5 2.9-.52 4.48-2.1 5-5Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

/**
 * 设置入口图标：对称精密六齿齿轮 + 舒展内孔，替代易与筛选混淆的双滑杆图标。
 */
export function SettingsGearIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-rail-glyph="settings"
      className={className}
    >
      <path d="M10.44 3.14 L13.56 3.14 L14.31 5.66 A6.75 6.75 0 0 1 16.34 6.83 L18.89 6.21 L20.46 8.92 L18.65 10.83 A6.75 6.75 0 0 1 18.65 13.17 L20.46 15.08 L18.89 17.79 L16.34 17.17 A6.75 6.75 0 0 1 14.31 18.34 L13.56 20.86 L10.44 20.86 L9.69 18.34 A6.75 6.75 0 0 1 7.66 17.17 L5.11 17.79 L3.54 15.08 L5.35 13.17 A6.75 6.75 0 0 1 5.35 10.83 L3.54 8.92 L5.11 6.21 L7.66 6.83 A6.75 6.75 0 0 1 9.69 5.66 Z" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  );
}

/**
 * 设置页「通用」分类图标：三行精密调校滑杆，避免在设置窗口内再次重复外层齿轮。
 */
export function GeneralPreferencesIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-nav-glyph="general"
      className={className}
    >
      <path d="M3.5 6h8.5" />
      <path d="M18 6h2.5" />
      <path d="M15 4v4" />
      <path d="M3.5 12h2.5" />
      <path d="M12 12h8.5" />
      <path d="M9 10v4" />
      <path d="M3.5 18h7.5" />
      <path d="M17 18h3.5" />
      <path d="M14 16v4" />
    </svg>
  );
}
