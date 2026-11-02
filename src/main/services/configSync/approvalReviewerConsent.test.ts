import { describe, expect, it } from 'vitest';
import { approvalReviewerConsentConfiguration as configuration } from './approvalReviewerConsent';

const provider = {
  id: 'review',
  name: 'Review',
  api: 'openai-completions',
  enabled: true,
  apiKey: 'fixture',
  baseUrl: 'https://review.invalid',
  models: [{ id: 'model' }],
};
const state = {
  approvalReviewer: { providerId: 'review', modelId: 'model' },
  providers: [provider],
};

describe('approval reviewer local consent configuration', () => {
  it('ignores display metadata and unrelated providers/models', () => {
    expect(
      configuration({
        ...state,
        providers: [
          {
            ...provider,
            name: 'Renamed',
            models: [{ id: 'model', label: 'Renamed' }, { id: 'other' }],
          },
          { ...provider, id: 'other', apiKey: 'unrelated' },
        ],
      })
    ).toEqual(configuration(state));
  });
  it('binds selected model capabilities, endpoint and authentication source', () => {
    for (const patch of [
      { baseUrl: 'https://other.invalid' },
      { api: 'anthropic-messages' },
      { apiKey: 'different-fixture' },
      { oauthAccountKey: 'anthropic#2' },
      { catalogId: 'typesafe' },
      { models: [{ id: 'model', maxTokens: 2000 }] },
      { enabled: false },
    ]) {
      expect(configuration({ ...state, providers: [{ ...provider, ...patch }] })).not.toEqual(
        configuration(state)
      );
    }
  });
  it('binds virtual primary and fast dependencies, which can each become the direct reviewer', () => {
    const virtual = {
      approvalReviewer: { providerId: 'enso-virtual', modelId: 'v' },
      virtualModels: [
        {
          id: 'v',
          name: 'Virtual',
          enabled: true,
          primary: state.approvalReviewer,
          fast: { providerId: 'fast', modelId: 'model' },
          fallbacks: [],
        },
      ],
      providers: [provider, { ...provider, id: 'fast' }],
    };
    for (const id of ['review', 'fast']) {
      expect(
        configuration({
          ...virtual,
          providers: virtual.providers.map((item) =>
            item.id === id ? { ...item, apiKey: 'changed' } : item
          ),
        })
      ).not.toEqual(configuration(virtual));
    }
  });
  it('binds account pool member availability as an authentication dependency', () => {
    const pool = {
      ...state,
      providers: [
        { ...provider, oauthAccountPool: { accountKeys: ['openai-codex#2'] } },
        { ...provider, id: 'member', oauthAccountKey: 'openai-codex#2' },
      ],
    };
    expect(
      configuration({
        ...pool,
        providers: pool.providers.map((item) =>
          item.id === 'member' ? { ...item, enabled: false } : item
        ),
      })
    ).not.toEqual(configuration(pool));
  });
  it('handles malformed and missing persisted configuration without throwing', () => {
    for (const dirty of [
      {},
      { approvalReviewer: null },
      { approvalReviewer: 'bad' },
      { ...state, providers: [null, 1, { id: 'review', models: [null, 1] }] },
    ])
      expect(() => configuration(dirty)).not.toThrow();
  });
});
