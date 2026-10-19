// 设计令牌：Web 与移动端共用的颜色、间距、圆角和字号。
// 原始来源见 archive/docs/design-system.md，现在直接在本文件维护。

export const DESIGN_COLOR_TOKENS = {
  'color.brand.primary': { light: '#176B5B', dark: '#76D4B5' },
  'color.surface.canvas': { light: '#FAF8F3', dark: '#101714' },
  'color.surface.default': { light: '#FFFFFF', dark: '#18211D' },
  'color.surface.subtle': { light: '#F2EFE7', dark: '#202B26' },
  'color.surface.raised': { light: '#FFFFFF', dark: '#243029' },
  'color.surface.inverse': { light: '#1E2925', dark: '#F2F5F3' },
  'color.surface.sensitiveMask': { light: '#E4E9E6', dark: '#2B3530' },
  'color.text.primary': { light: '#1E2925', dark: '#F2F5F3' },
  'color.text.secondary': { light: '#52615B', dark: '#BFCAC5' },
  'color.text.tertiary': { light: '#66736D', dark: '#95A39C' },
  'color.text.inverse': { light: '#FFFFFF', dark: '#14201B' },
  'color.text.link': { light: '#075EBA', dark: '#9CCAFF' },
  'color.border.default': { light: '#C2CBC6', dark: '#3C4943' },
  'color.border.strong': { light: '#6F7D77', dark: '#95A39C' },
  'color.action.primary': { light: '#176B5B', dark: '#76D4B5' },
  'color.action.primary.hover': { light: '#125B4D', dark: '#8ADFC4' },
  'color.action.primary.pressed': { light: '#0D493D', dark: '#5BC3A4' },
  'color.action.onPrimary': { light: '#FFFFFF', dark: '#0D3027' },
  'color.action.disabled': { light: '#D8DEDA', dark: '#3B4741' },
  'color.action.onDisabled': { light: '#707A75', dark: '#8E9A94' },
  'color.focus.ring': { light: '#075EBA', dark: '#9CCAFF' },
  'color.overlay.scrim': { light: 'rgba(12,20,17,0.48)', dark: 'rgba(0,0,0,0.72)' },
  'color.state.neutral.foreground': { light: '#45524C', dark: '#C2CCC7' },
  'color.state.neutral.container': { light: '#E9EEEB', dark: '#29312E' },
  'color.state.info.foreground': { light: '#1E568B', dark: '#9CCAFF' },
  'color.state.info.container': { light: '#E5EFFA', dark: '#17334D' },
  'color.state.success.foreground': { light: '#1C613C', dark: '#89D7A9' },
  'color.state.success.container': { light: '#E2F2E8', dark: '#163724' },
  'color.state.warning.foreground': { light: '#754300', dark: '#F4C16C' },
  'color.state.warning.container': { light: '#FFF0D6', dark: '#453119' },
  'color.state.danger.foreground': { light: '#96241D', dark: '#FFB4AB' },
  'color.state.danger.container': { light: '#FCE8E6', dark: '#482421' },
} as const;

export const DESIGN_TYPE_TOKENS = {
  'type.display': { fontSize: 32, fontWeight: '600', lineHeight: 40 },
  'type.title.1': { fontSize: 28, fontWeight: '600', lineHeight: 36 },
  'type.title.2': { fontSize: 22, fontWeight: '600', lineHeight: 30 },
  'type.title.3': { fontSize: 18, fontWeight: '600', lineHeight: 26 },
  'type.body.large': { fontSize: 17, fontWeight: '400', lineHeight: 26 },
  'type.body': { fontSize: 16, fontWeight: '400', lineHeight: 24 },
  'type.body.small': { fontSize: 14, fontWeight: '400', lineHeight: 21 },
  'type.label.large': { fontSize: 16, fontWeight: '600', lineHeight: 22 },
  'type.label': { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  'type.caption': { fontSize: 12, fontWeight: '400', lineHeight: 18 },
} as const;

export const DESIGN_SPACE_TOKENS = {
  'space.0': 0,
  'space.0_5': 2,
  'space.1': 4,
  'space.2': 8,
  'space.3': 12,
  'space.4': 16,
  'space.5': 20,
  'space.6': 24,
  'space.8': 32,
  'space.10': 40,
  'space.12': 48,
  'space.16': 64,
} as const;

export const DESIGN_RADIUS_TOKENS = {
  'radius.xs': 4,
  'radius.sm': 8,
  'radius.md': 12,
  'radius.lg': 16,
  'radius.xl': 24,
  'radius.full': 999,
} as const;
