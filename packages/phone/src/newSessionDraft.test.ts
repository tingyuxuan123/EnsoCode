import { describe, expect, it } from 'vitest';
import { draftRequest, EMPTY_DRAFT, newSessionDraft } from './newSessionDraft';

const image = (marker: string) => ({ data: marker, mimeType: 'image/jpeg' });

describe('newSessionDraft', () => {
  it('关闭抽屉保留已输入的正文和图片', () => {
    const filled = newSessionDraft(EMPTY_DRAFT, { type: 'text', text: '修好这个测试' });
    const withImage = newSessionDraft(filled, { type: 'add-images', images: [image('a')] });
    expect(newSessionDraft(withImage, { type: 'close' })).toEqual(withImage);
    expect(newSessionDraft(withImage, { type: 'close' }).text).toBe('修好这个测试');
  });

  it('新建成功后才清空，重新打开是干净状态', () => {
    const filled = newSessionDraft(EMPTY_DRAFT, { type: 'text', text: '写迁移脚本' });
    expect(newSessionDraft(filled, { type: 'create' })).toEqual(EMPTY_DRAFT);
  });

  it('多次选图累积，按序号移除一张', () => {
    const one = newSessionDraft(EMPTY_DRAFT, { type: 'add-images', images: [image('a')] });
    const two = newSessionDraft(one, { type: 'add-images', images: [image('b')] });
    expect(two.images.map((i) => i.data)).toEqual(['a', 'b']);
    expect(
      newSessionDraft(two, { type: 'remove-image', index: 0 }).images.map((i) => i.data)
    ).toEqual(['b']);
  });

  it('选图失败（空列表）不改动草稿', () => {
    const filled = newSessionDraft(EMPTY_DRAFT, { type: 'text', text: '一半' });
    expect(newSessionDraft(filled, { type: 'add-images', images: [] })).toBe(filled);
  });
});

describe('draftRequest', () => {
  it('空正文无图不产出 draft（传空对象会被当成已发送）', () => {
    expect(draftRequest(EMPTY_DRAFT)).toBeUndefined();
    expect(draftRequest({ text: '  \n ', images: [] })).toBeUndefined();
  });

  it('正文去首尾空白，图片原样带上', () => {
    expect(draftRequest({ text: '  修好登录页  ', images: [image('a')] })).toEqual({
      text: '修好登录页',
      images: [image('a')],
    });
  });

  it('只有图片没有文字也能带过去', () => {
    expect(draftRequest({ text: '', images: [image('a')] })).toEqual({
      text: '',
      images: [image('a')],
    });
  });
});
