import en from '../vetta/locales/en.json';
import zh from '../vetta/locales/zh.json';
import { resolveCatalogKey } from '../vetta/sdk/i18n';
import { useDesignLocale } from './locale';

export function translate(key: string, params?: Record<string, string | number>): string {
  return resolveCatalogKey(
    key.replace(/^%|%$/g, ''),
    { en, zh },
    useDesignLocale.getState().locale,
    'zh',
    params
  );
}
export function useTranslation() {
  const language = useDesignLocale((state) => state.locale);
  return { locale: language, t: translate };
}
