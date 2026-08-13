import {
  DESIGN_COLOR_TOKENS,
  DESIGN_RADIUS_TOKENS,
  DESIGN_SPACE_TOKENS,
  DESIGN_TYPE_TOKENS,
} from './generated/design-tokens.generated';

export type LifeBookColorScheme = 'dark' | 'light';
export type LifeBookColorToken = keyof typeof DESIGN_COLOR_TOKENS;

function color(token: LifeBookColorToken, scheme: LifeBookColorScheme): string {
  return DESIGN_COLOR_TOKENS[token][scheme];
}

export function createLifeBookTheme(scheme: LifeBookColorScheme) {
  return {
    scheme,
    color: {
      actionPrimary: color('color.action.primary', scheme),
      borderDefault: color('color.border.default', scheme),
      borderStrong: color('color.border.strong', scheme),
      brandPrimary: color('color.brand.primary', scheme),
      canvas: color('color.surface.canvas', scheme),
      stateInfoContainer: color('color.state.info.container', scheme),
      stateInfoForeground: color('color.state.info.foreground', scheme),
      surface: color('color.surface.default', scheme),
      surfaceSubtle: color('color.surface.subtle', scheme),
      textPrimary: color('color.text.primary', scheme),
      textSecondary: color('color.text.secondary', scheme),
      textTertiary: color('color.text.tertiary', scheme),
    },
    radius: DESIGN_RADIUS_TOKENS,
    space: DESIGN_SPACE_TOKENS,
    type: DESIGN_TYPE_TOKENS,
  } as const;
}

export type LifeBookTheme = ReturnType<typeof createLifeBookTheme>;
