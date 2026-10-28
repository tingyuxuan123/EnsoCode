import { useMemo } from 'react';
import { defaultDarkTheme, getXtermTheme } from '@/lib/ghosttyTheme';
import { matchTerminalBackground, readAppPanelColor } from '@/lib/terminalSurface';
import { stripAnsi } from '@/lib/terminalText';
import { useSettingsStore } from '@/stores/settings';

/** bash 工具输出：沿用终端配色与等宽字体族，但字号/字重跟随聊天流（text-[calc(11rem/14)]），不套终端那套大字号 */
export function TerminalOutput({ command, output }: { command: string; output: string }) {
  const terminalTheme = useSettingsStore((s) => s.terminalTheme);
  const appTheme = useSettingsStore((s) => s.theme);
  const fontFamily = useSettingsStore((s) => s.terminalFontFamily);
  const theme = getXtermTheme(terminalTheme) ?? defaultDarkTheme;
  // 与右侧面板终端一致：底色对齐应用面板，16 色与前景仍取终端配色
  // biome-ignore lint/correctness/useExhaustiveDependencies: 应用主题模式变化后 --panel 才会变，必须借此重读
  const background = useMemo(
    () => matchTerminalBackground(theme.background, readAppPanelColor()),
    [theme, appTheme]
  );

  return (
    <div
      data-slot="terminal-output"
      className="px-3 py-2 text-[calc(11rem/14)] leading-relaxed"
      style={{
        backgroundColor: background,
        ['--terminal-bg' as string]: background,
        color: theme.foreground,
        fontFamily,
      }}
    >
      <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">
        <span style={{ color: theme.green }}>$ </span>
        {command}
      </div>
      {output && (
        <pre
          className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]"
          style={{ fontFamily: 'inherit' }}
        >
          {stripAnsi(output)}
        </pre>
      )}
    </div>
  );
}
