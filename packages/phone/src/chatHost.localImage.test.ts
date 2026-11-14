import { describe, expect, it, vi } from 'vitest';
import { phoneChatHost } from './chatHost';

describe('phoneChatHost.readLocalImage（手机看会话图片）', () => {
  it('把绝对路径换成工作区相对路径再请 host 读，回 data URL', async () => {
    const readImage = vi.fn(async () => ({ dataUrl: 'data:image/png;base64,AA==' }));
    const host = phoneChatHost({ sessionId: 's', cwd: '/work/proj', readImage });
    await expect(host.readLocalImage?.('/work/proj/shots/a.png')).resolves.toEqual({
      ok: true,
      dataUrl: 'data:image/png;base64,AA==',
    });
    expect(readImage).toHaveBeenCalledWith('shots/a.png');
  });

  it('目录外的图不上行路径，直接给可解释的失败', async () => {
    const readImage = vi.fn(async () => ({ dataUrl: 'data:image/png;base64,AA==' }));
    const host = phoneChatHost({ sessionId: 's', cwd: '/work/proj', readImage });
    await expect(host.readLocalImage?.('/etc/passwd.png')).resolves.toEqual({
      ok: false,
      error: 'outside',
    });
    expect(readImage).not.toHaveBeenCalled();
  });

  it('host 侧错误码原样交给渲染层，不伪造成功', async () => {
    const readImage = vi.fn(async () => ({ error: 'too-large' }));
    const host = phoneChatHost({ sessionId: 's', cwd: '/work/proj', readImage });
    await expect(host.readLocalImage?.('/work/proj/a.png')).resolves.toEqual({
      ok: false,
      error: 'too-large',
    });
  });

  it('没有图片通道（旧桌面）时不提供 hook，时间线保持纯文本回退', () => {
    expect(phoneChatHost({ sessionId: 's', cwd: '/work/proj' }).readLocalImage).toBeUndefined();
  });
});
