/**
 * AntiGravity Design System — Centralized Tokens
 * Import this instead of hardcoding hex values anywhere.
 */

export const C = {
  // Backgrounds
  bg:         '#060A0E',
  surface:    '#0D1117',
  surface2:   '#141C24',
  surface3:   '#1A2333',

  // Borders
  border:     'rgba(255, 255, 255, 0.07)',
  borderSub:  'rgba(255, 255, 255, 0.04)',

  // Accent — AntiGravity Mint
  accent:     '#00C896',
  accentDim:  'rgba(0, 200, 150, 0.12)',
  accentGlow: 'rgba(0, 200, 150, 0.25)',

  // Text
  text:       '#E8EDF2',
  textSub:    '#5A6475',
  textDim:    '#2E3A4A',

  // Danger / Skip
  red:        '#FF3B30',
  redDim:     'rgba(255, 59, 48, 0.12)',

  // Warning (mid score)
  yellow:     '#F5A623',
  yellowDim:  'rgba(245, 166, 35, 0.12)',

  // White/black helpers
  white:      '#FFFFFF',
  black:      '#000000',
} as const;

export const T = {
  // Font sizes
  xs:    10,
  sm:    12,
  base:  13,
  md:    15,
  lg:    16,
  xl:    18,
  xxl:   22,
  disp:  28,

  // Font weights (as strings for RN)
  regular:     '400' as const,
  medium:      '500' as const,
  semibold:    '600' as const,
  bold:        '700' as const,
  black_w:     '800' as const,

  // Line heights
  tight:  16,
  normal: 18,
  loose:  22,
} as const;

export const R = {
  // Border radius
  sm:   6,
  md:   10,
  lg:   14,
  xl:   20,
  pill: 100,
} as const;

export const S = {
  // Spacing
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,
  xl:   20,
  xxl:  28,
  xxxl: 40,
} as const;

export const SHADOW = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 12,
    elevation: 8,
  },
  elevated: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 20,
    elevation: 14,
  },
  subtle: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
} as const;
