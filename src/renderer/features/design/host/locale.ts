import { create } from 'zustand';
/** Headless SDK imports must not initialize EnsoCode's persisted settings store. */
export const useDesignLocale = create<{ locale: string }>(() => ({ locale: 'zh' }));
