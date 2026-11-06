import { describe, expect, it } from 'vitest';
import { chunkDesignActivity, designWindowRoot } from './design-windows';

describe('designWindowRoot', () => {
  const conversations = {
    root: {},
    child: { parentId: 'root' },
    orphan: { parentId: 'gone' },
  };
  it('maps child tabs and coworker ids to the root session Main binds windows to', () => {
    expect(designWindowRoot('root', conversations)).toBe('root');
    expect(designWindowRoot('child', conversations)).toBe('root');
    expect(designWindowRoot('root::cw-1', conversations)).toBe('root');
    expect(designWindowRoot('child::cw-2', conversations)).toBe('root');
  });
  it('keeps unknown ids and dangling parents as-is', () => {
    expect(designWindowRoot('x', conversations)).toBe('x');
    expect(designWindowRoot('orphan', conversations)).toBe('gone');
  });
});

describe('chunkDesignActivity', () => {
  it('always yields at least one (possibly empty) chunk so state still reaches the window', () => {
    expect(chunkDesignActivity([], 3)).toEqual([[]]);
  });
  it('splits into chunks no larger than the Main limit, preserving order', () => {
    expect(chunkDesignActivity([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });
});
