import type { ThemeTokens } from './types';

const TOKEN_KEY = /^--[a-z0-9-]+$/;
export const isSafeTokenValue = (value: string): boolean => !/[;{}<>\\\r\n]|\/\*/.test(value);
export function sanitizeTokens(tokens: Record<string, unknown>): ThemeTokens {
  const kept: ThemeTokens = {};
  for (const [key, value] of Object.entries(tokens))
    if (TOKEN_KEY.test(key) && typeof value === 'string' && value.trim() && isSafeTokenValue(value))
      kept[key] = value.trim();
  return kept;
}
export function tokensCss(selector: string, tokens: ThemeTokens): string {
  return `${selector} {\n${Object.entries(sanitizeTokens(tokens))
    .map(([key, value]) => `  ${key}: ${value};\n`)
    .join('')}}\n`;
}
