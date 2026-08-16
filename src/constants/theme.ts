/**
 * LeashOff design tokens — a walking-trail material palette (leather / rope /
 * brass), see screen-implementation-handoff.md section 4 for the source palette.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#211F1B',
    textSecondary: '#6B6355',
    background: '#E8E1D3',
    backgroundElement: '#F1ECE1',
    backgroundSelected: '#DCD2BC',
    primary: '#2B3A2E',
    primaryDark: '#1E2921',
    onPrimary: '#F1ECE1',
    accent: '#B08D57',
    accentLight: '#C7A876',
    leather: '#8B5E3C',
    border: '#D6CBB2',
    danger: '#8B4A3C',
  },
  dark: {
    text: '#F1ECE1',
    textSecondary: '#B8AE98',
    background: '#1E2921',
    backgroundElement: '#26332A',
    backgroundSelected: '#324035',
    primary: '#C7A876',
    primaryDark: '#B08D57',
    onPrimary: '#1E2921',
    accent: '#B08D57',
    accentLight: '#C7A876',
    leather: '#B98455',
    border: '#3A473C',
    danger: '#C97B65',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  small: 8,
  medium: 14,
  large: 24,
  pill: 999,
} as const;

export const MaxContentWidth = 800;
