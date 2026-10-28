import { useState } from 'react';
import { useLocation } from 'react-router';

/**
 * 状态帧向面板视图注入初始状态的通道（SidePanel 渲染视图时不传参数）。
 * 帧在渲染时调用 usePanelPreset(kind, value)；视图挂载时用 readPanelPreset(kind) 读取，
 * 只在同一路由下生效，切到其他帧后自动失效。
 */
const presets: Record<string, { path: string; value: unknown }> = {};

export function usePanelPreset<T>(kind: string, value: T) {
  const { pathname } = useLocation();
  useState(() => {
    presets[kind] = { path: pathname, value };
    return true;
  });
}

export function useReadPanelPreset<T>(kind: string): Partial<T> {
  const { pathname } = useLocation();
  const entry = presets[kind];
  if (entry && entry.path === pathname) return entry.value as Partial<T>;
  return {};
}

/** 面板视图读取帧注入的初始状态（SidePanel 会按 rev 重挂载视图，所以这里在挂载时读一次就够） */
export function usePanelState<T>(kind: string, injected: { kind: string; value: Record<string, unknown>; rev: number } | null): Partial<T> {
  return useReadPanelPreset<T>(kind);
}
