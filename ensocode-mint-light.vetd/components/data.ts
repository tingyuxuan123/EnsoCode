export const changes = [
  { path: 'src/renderer/features/design/host/activity-dock.test.ts', added: 9, removed: 2 },
  { path: 'src/renderer/features/design/host/context.ts', added: 4, removed: 2 },
  { path: 'src/renderer/lib/sidePanelDock.ts', added: 2, removed: 1 },
  { path: 'src/renderer/stores/sidePanel/index.ts', added: 15, removed: 1 },
  { path: 'src/renderer/stores/sidePanel/maximize.test.ts', added: 27, removed: 0 },
  { path: 'src/renderer/stores/sidePanel/width.ts', added: 2, removed: 0 },
];

export const totals = changes.reduce((total, file) => ({
  added: total.added + file.added,
  removed: total.removed + file.removed,
}), { added: 0, removed: 0 });

export const sessions = [
  { id: 'dock', title: '设计面板展开', summary: '保留会话区，不再全屏覆盖', icon: 'icon-[lucide--panels-top-left]', commit: 'ad3b0dd0' },
  { id: 'sidebar', title: '侧栏折叠与宽度', summary: '展开面板时让出项目栏', icon: 'icon-[lucide--panel-left]', commit: 'c8d2aa08' },
  { id: 'canvas', title: '画布活动提示', summary: '把工具活动传到画布', icon: 'icon-[lucide--activity]', commit: '79773369' },
  { id: 'release', title: '个人版更新', summary: '0.2.45 发布记录', icon: 'icon-[lucide--package]', commit: '149bcb30' },
];

export const palettes = [
  { label: '瓷白', role: '主内容 · 对话', hex: '#FFFFFF', token: 'bg-surface' },
  { label: '雾灰', role: '侧栏 · 面板', hex: '#F6F7F6', token: 'bg-panel' },
  { label: '浅薄荷', role: '选中底色 · 状态', hex: '#E7F7EC', token: 'bg-mint' },
  { label: '鲜绿', role: '指示器 · 图形', hex: '#10BF59', token: 'bg-signal' },
  { label: '深绿', role: '按钮 · 状态文字', hex: '#08763E', token: 'bg-primary' },
  { label: '墨黑', role: '标题 · 正文', hex: '#18221D', token: 'bg-surface-foreground' },
];

export const patchSamples: Record<string, { note: string; lines: { kind: 'context' | 'add' | 'remove'; text: string }[] }> = {
  'activity-dock.test.ts': { note: '验证设计面板展开后未进入全屏。', lines: [
    { kind: 'remove', text: 'expect(side.setFullscreen).toHaveBeenCalledWith(true);' },
    { kind: 'add', text: "expect(side.maximize).toHaveBeenCalledWith('s');" },
    { kind: 'add', text: 'expect(side.setFullscreen).not.toHaveBeenCalled();' },
  ] },
  'context.ts': { note: '画布请求最大宽度时，调用停靠面板的展开动作。', lines: [
    { kind: 'context', text: 'const target = useSessionsStore.getState().activeId;' },
    { kind: 'remove', text: "if (width === 'max') useSidePanelStore.getState().setFullscreen(true);" },
    { kind: 'add', text: 'if (!target) return;' },
    { kind: 'add', text: "if (width === 'max') useSidePanelStore.getState().maximize(target);" },
  ] },
  'sidePanelDock.ts': { note: '停靠的设计面板现在使用展开，而不是全屏。', lines: [
    { kind: 'remove', text: "if (opts?.width === 'max' && sessions.activeId === dockId) side.setFullscreen(true);" },
    { kind: 'add', text: "if (opts?.width === 'max') side.maximize(dockId);" },
    { kind: 'context', text: "else if (typeof opts?.width === 'number') side.setWidth(dockId, opts.width);" },
  ] },
  'index.ts': { note: '在侧面板状态中单独记录展开动作。', lines: [
    { kind: 'add', text: 'maximize: (id) => {' },
    { kind: 'add', text: '  if (get().fullscreen) return;' },
    { kind: 'add', text: '  set({' },
    { kind: 'add', text: '    uiByConversation: patchUi(get(), id, { open: true, width: SIDE_PANEL_MAX_PREFERENCE }),' },
    { kind: 'add', text: '  });' },
    { kind: 'add', text: '},' },
  ] },
  'maximize.test.ts': { note: '覆盖用户已在全屏状态时不打断的场景。', lines: [
    { kind: 'add', text: 'useSidePanelStore.setState({ fullscreen: true });' },
    { kind: 'add', text: "useSidePanelStore.getState().maximize('s');" },
    { kind: 'add', text: 'expect(useSidePanelStore.getState().fullscreen).toBe(true);' },
  ] },
  'width.ts': { note: '展开宽度是偏好值，实际显示仍受工作区约束。', lines: [
    { kind: 'context', text: 'export const SIDE_PANEL_HANDLE_WIDTH = 1;' },
    { kind: 'add', text: 'export const SIDE_PANEL_MAX_PREFERENCE = 100_000;' },
  ] },
};
