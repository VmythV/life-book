import { describe, expect, it } from 'vitest';

import { createLifeBookTheme } from './theme';

describe('design token themes', () => {
  it('provides distinct complete light and dark values', () => {
    const light = createLifeBookTheme('light');
    const dark = createLifeBookTheme('dark');

    expect(light.color.canvas).not.toBe(dark.color.canvas);
    expect(light.color.textPrimary).not.toBe(dark.color.textPrimary);
    expect(Object.keys(light.color)).toEqual(Object.keys(dark.color));
  });
});
