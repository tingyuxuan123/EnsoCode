import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalReviewerPicker } from './ApprovalReviewerPicker';

const mock = vi.hoisted(() => ({
  state: {
    approvalReviewer: { providerId: 'ts', modelId: 'jev' } as {
      providerId: string;
      modelId: string;
    } | null,
    approvalAutoManage: false,
    approvalAllowThreshold: 0.9,
    setApprovalReviewer: vi.fn(),
    setApprovalAutoManage: vi.fn(),
    setApprovalAllowThreshold: vi.fn(),
  },
}));
vi.mock('@/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (value: typeof mock.state) => unknown) => selector(mock.state),
}));
vi.mock('@/stores/modelDirectory/useProviders', () => ({
  useUsableProviders: () => [{ id: 'chat', models: [{ id: 'llm' }] }],
  useUsableClassifierProviders: () => [
    {
      id: 'ts',
      api: 'typesafe-system-one',
      baseUrl: 'https://api.typesafe.ai',
      models: [{ id: 'jev' }],
    },
  ],
}));
vi.mock('@/components/chat/ModelPicker', () => ({
  MODEL_PICKER_FORM_TRIGGER_CLASS: '',
  ModelPicker: () => createElement('div', {}, 'picker'),
}));
vi.mock('@/components/ui/switch', () => ({
  Switch: (props: { checked: boolean; 'aria-label': string }) =>
    createElement('input', {
      type: 'checkbox',
      checked: props.checked,
      readOnly: true,
      'aria-label': props['aria-label'],
    }),
}));
const render = () => renderToStaticMarkup(createElement(ApprovalReviewerPicker));
describe('explicit local management switch', () => {
  it('offers an unchecked switch for classifiers without enabling it during render', () => {
    mock.state.approvalReviewer = { providerId: 'ts', modelId: 'jev' };
    const html = render();
    expect(html).toContain('Auto-manage approvals');
    expect(html).toContain('Auto-allow threshold');
    expect(html).not.toContain('checked=""');
    expect(mock.state.setApprovalAutoManage).not.toHaveBeenCalled();
  });
  it('never offers management for ordinary LLM review', () => {
    mock.state.approvalReviewer = { providerId: 'chat', modelId: 'llm' };
    expect(render()).not.toContain('Auto-manage approvals');
  });
});
