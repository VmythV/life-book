import {
  DESIGN_COLOR_TOKENS,
  DESIGN_RADIUS_TOKENS,
  DESIGN_SPACE_TOKENS,
  DESIGN_TYPE_TOKENS,
} from './tokens';

export type LifeBookColorScheme = 'dark' | 'light';
export type LifeBookColorToken = keyof typeof DESIGN_COLOR_TOKENS;

function color(token: LifeBookColorToken, scheme: LifeBookColorScheme): string {
  return DESIGN_COLOR_TOKENS[token][scheme];
}

export function createLifeBookTheme(scheme: LifeBookColorScheme) {
  return {
    scheme,
    color: {
      actionDisabled: color('color.action.disabled', scheme),
      actionOnDisabled: color('color.action.onDisabled', scheme),
      actionOnPrimary: color('color.action.onPrimary', scheme),
      actionPrimary: color('color.action.primary', scheme),
      actionPrimaryHover: color('color.action.primary.hover', scheme),
      actionPrimaryPressed: color('color.action.primary.pressed', scheme),
      borderDefault: color('color.border.default', scheme),
      borderStrong: color('color.border.strong', scheme),
      brandPrimary: color('color.brand.primary', scheme),
      canvas: color('color.surface.canvas', scheme),
      focusRing: color('color.focus.ring', scheme),
      stateDangerContainer: color('color.state.danger.container', scheme),
      stateDangerForeground: color('color.state.danger.foreground', scheme),
      stateInfoContainer: color('color.state.info.container', scheme),
      stateInfoForeground: color('color.state.info.foreground', scheme),
      stateSuccessContainer: color('color.state.success.container', scheme),
      stateSuccessForeground: color('color.state.success.foreground', scheme),
      stateWarningContainer: color('color.state.warning.container', scheme),
      stateWarningForeground: color('color.state.warning.foreground', scheme),
      overlayScrim: color('color.overlay.scrim', scheme),
      surface: color('color.surface.default', scheme),
      surfaceRaised: color('color.surface.raised', scheme),
      surfaceSubtle: color('color.surface.subtle', scheme),
      textLink: color('color.text.link', scheme),
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
