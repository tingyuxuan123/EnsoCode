import { describe, expect, it } from 'vitest';
import { pluginViewLabel } from './pluginViewLabel';

describe('pluginViewLabel', () => {
  it('shows the name once when the view and plugin share it', () => {
    expect(pluginViewLabel({ title: '知识地图', pluginName: '知识地图' })).toBe('知识地图');
  });

  it('keeps both labels when the view is more specific', () => {
    expect(pluginViewLabel({ title: '项目知识', pluginName: '知识地图' })).toBe(
      '项目知识 · 知识地图'
    );
  });
});
