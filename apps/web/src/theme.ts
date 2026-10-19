import { createLifeBookTheme, type LifeBookColorScheme } from '@life-book/design-tokens';

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function applyTheme(scheme: LifeBookColorScheme): void {
  const root = document.documentElement;
  const theme = createLifeBookTheme(scheme);
  for (const [name, value] of Object.entries(theme.color)) {
    root.style.setProperty(`--lb-${toKebabCase(name)}`, value);
  }
  root.style.colorScheme = scheme;
}

/** 把设计令牌写成 CSS 变量，并跟随系统的浅色/深色模式切换。 */
export function installTheme(): void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => applyTheme(query.matches ? 'dark' : 'light');
  update();
  query.addEventListener('change', update);
}
