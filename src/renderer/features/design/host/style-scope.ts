import postcss, { type AtRule, type Container, type Node } from 'postcss';
import selectorParser from 'postcss-selector-parser';
import type { Plugin } from 'vite';

const ROOT = '[data-vetta-plugin-root="vetta-ui-design"]';
const keyframes = /(?:^|-)keyframes$/i;

/** Apply AFTER Tailwind compilation, never to the host's stylesheet/bundle. */
export function scopeDesignCss(css: string): string {
  const root = postcss.parse(css);
  root.walkRules((rule) => {
    let parent: Node | undefined = rule.parent;
    while (parent) {
      if (
        parent.type === 'atrule' &&
        'name' in parent &&
        typeof parent.name === 'string' &&
        keyframes.test(parent.name)
      )
        return;
      parent = parent.parent;
    }
    rule.selector = selectorParser((selectors) => {
      selectors.walkPseudos((pseudo) => {
        if (pseudo.value === ':root' || pseudo.value === ':host') {
          const args = pseudo.nodes?.[0]?.nodes.map((node) => node.clone()) ?? [];
          pseudo.replaceWith(selectorParser.pseudo({ value: ':scope' }), ...args);
        }
      });
    }).processSync(rule.selector);
  });
  const scope = (container: Container) => {
    let current: AtRule | undefined;
    let icons: AtRule | undefined;
    for (const node of [...(container.nodes ?? [])]) {
      if (node.type === 'rule') {
        const parsed = selectorParser().astSync(node.selector);
        if (
          parsed.nodes.every((selector) => {
            const [part] = selector.nodes;
            return (
              selector.nodes.length === 1 &&
              part?.type === 'class' &&
              /^icon-\[[\w-]+--[\w-]+\]$/.test(part.value)
            );
          })
        ) {
          current = undefined;
          if (!icons) {
            const layer = postcss.atRule({ name: 'layer', params: 'vetta-plugin-icons' });
            icons = postcss.atRule({ name: 'scope', params: `(${ROOT})` });
            layer.append(icons);
            node.before(layer);
          }
          icons.append(node);
          continue;
        }
        icons = undefined;
        if (!current) {
          current = postcss.atRule({ name: 'scope', params: `(${ROOT})` });
          node.before(current);
        }
        current.append(node);
      } else {
        current = undefined;
        icons = undefined;
        if (node.type === 'atrule' && node.nodes && !keyframes.test(node.name)) scope(node);
      }
    }
  };
  scope(root);
  return root.toString();
}

export function isDesignStylesheet(id: string): boolean {
  return (
    id.split('?')[0].replaceAll('\\', '/').endsWith('/features/design/vetta/src/style.css') &&
    !/[?&](?:raw|url|worker|sharedworker)(?:[=&]|$)/.test(id)
  );
}

export function designStyleScopePlugin(): Plugin {
  return {
    name: 'enso-design-style-scope',
    // Tailwind's compiler is enforce:pre. Place this AFTER tailwindcss() so both
    // serve/build see compiled CSS, BEFORE vite:css turns it into a JS module.
    enforce: 'pre',
    transform(code, id) {
      if (!isDesignStylesheet(id)) return;
      return { code: scopeDesignCss(code), map: null };
    },
  };
}
