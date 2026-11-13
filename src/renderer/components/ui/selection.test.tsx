import { parseHTML } from 'linkedom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Checkbox } from './checkbox';
import { Radio, RadioGroup } from './radio-group';
import { Slider } from './slider';
import { Switch } from './switch';
import { Tabs, TabsList, TabsTab } from './tabs';
import { Toggle } from './toggle';

const documentFor = (node: Parameters<typeof renderToStaticMarkup>[0]) =>
  parseHTML(renderToStaticMarkup(node)).document;

describe('shared selection controls', () => {
  it('checked switch uses the brand, not the upstream white primary', () => {
    const doc = documentFor(createElement(Switch, { checked: true }));
    expect(doc.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
    expect(
      doc.querySelector('[data-slot="switch"]')?.classList.contains('data-checked:bg-brand')
    ).toBe(true);
    expect(
      doc
        .querySelector('[data-slot="switch-thumb"]')
        ?.classList.contains('data-checked:bg-brand-foreground')
    ).toBe(true);
  });

  it('unchecked switch thumb remains visible instead of reusing the dark canvas', () => {
    const doc = documentFor(createElement(Switch, { checked: false }));
    expect(doc.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false');
    expect(
      doc
        .querySelector('[data-slot="switch-thumb"]')
        ?.classList.contains('dark:bg-muted-foreground')
    ).toBe(true);
  });

  it('checkbox and radio pair the brand background with its contrasting foreground', () => {
    const checkbox = documentFor(createElement(Checkbox, { checked: true }));
    const radio = documentFor(
      createElement(RadioGroup, { value: 'a' }, createElement(Radio, { value: 'a' }))
    );
    for (const [doc, slot] of [
      [checkbox, 'checkbox'],
      [radio, 'radio'],
    ] as const) {
      const indicator = doc.querySelector(`[data-slot="${slot}-indicator"]`);
      expect(indicator?.classList.contains('data-checked:bg-brand'), slot).toBe(true);
      expect(indicator?.className, slot).toContain('brand-foreground');
    }
  });

  it('pressed toggles and default tabs share a persistent selection surface', () => {
    const toggle = documentFor(createElement(Toggle, { pressed: true }, 'Choice'));
    expect(
      toggle.querySelector('[data-slot="toggle"]')?.classList.contains('data-pressed:bg-selection')
    ).toBe(true);
    for (const variant of ['default', 'underline'] as const) {
      const doc = documentFor(
        createElement(
          Tabs,
          { value: 'a' },
          createElement(TabsList, { variant }, createElement(TabsTab, { value: 'a' }, 'Choice'))
        )
      );
      const indicator = doc.querySelector('[data-slot="tab-indicator"]');
      expect(
        indicator?.classList.contains(variant === 'default' ? 'bg-selection' : 'bg-brand')
      ).toBe(true);
    }
  });

  it('slider selection fill follows the brand without recolouring its neutral thumb', () => {
    const doc = documentFor(createElement(Slider, { value: 50 }));
    expect(
      doc.querySelector('[data-slot="slider-indicator"]')?.classList.contains('bg-brand')
    ).toBe(true);
    expect(doc.querySelector('[data-slot="slider-thumb"]')?.classList.contains('bg-white')).toBe(
      true
    );
  });
});
