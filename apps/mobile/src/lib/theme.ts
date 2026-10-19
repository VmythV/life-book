import { createLifeBookTheme, type LifeBookTheme } from '@life-book/design-tokens';
import { useColorScheme } from 'react-native';

export function useTheme(): LifeBookTheme {
  return createLifeBookTheme(useColorScheme() === 'dark' ? 'dark' : 'light');
}
