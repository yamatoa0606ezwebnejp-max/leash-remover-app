import { getLocales } from 'expo-localization';
import { I18n, type TranslateOptions } from 'i18n-js';

import { en, type Dictionary } from './en';
import { ja } from './ja';

type KeyPath<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${KeyPath<T[K]>}`;
}[keyof T & string];

export type TranslationKey = KeyPath<Dictionary>;

const i18n = new I18n({ en, ja });

// iOS restarts the app when the language changes, so reading it once at startup is enough.
i18n.locale = getLocales()[0]?.languageCode === 'ja' ? 'ja' : 'en';
i18n.defaultLocale = 'en';
i18n.enableFallback = true;

export function t(key: TranslationKey, options?: TranslateOptions): string {
  return i18n.t(key, options);
}
