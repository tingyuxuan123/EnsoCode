import { File, Folder, PanelsTopLeft } from 'lucide-react';
import { expect, it } from 'vitest';
import { fileTypeIcon, fileTypeIconClass } from './fileIcons';

it('设计目录和新旧分享文件用宿主原生图标，不依赖上游data URL', () => {
  expect(fileTypeIcon('app.vetd', true)).toBe(PanelsTopLeft);
  expect(fileTypeIcon('app.vetd', true, true)).toBe(PanelsTopLeft);
  expect(fileTypeIcon('share.VETDZ', false)).toBe(PanelsTopLeft);
  expect(fileTypeIcon('legacy.vetd', false)).toBe(PanelsTopLeft);
  expect(fileTypeIconClass('app.vetd', true)).toBe('text-primary');
  expect(fileTypeIcon('normal', true)).toBe(Folder);
  expect(fileTypeIcon('normal', false)).toBe(File);
});
