import type { ConfigContext, ExpoConfig } from 'expo/config';

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  return {
    ...config,
    name: '生活有谱',
    slug: 'life-book',
    scheme: 'lifebook',
    version: '0.0.0',
    platforms: ['ios', 'android'],
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: 'dev.lifebook.app',
      supportsTablet: false,
    },
    android: {
      package: 'dev.lifebook.app',
      allowBackup: false,
      predictiveBackGestureEnabled: true,
    },
    plugins: [
      [
        'expo-build-properties',
        {
          ios: {
            deploymentTarget: '16.0',
          },
          android: {
            minSdkVersion: 29,
            compileSdkVersion: 36,
            targetSdkVersion: 36,
            buildToolsVersion: '36.0.0',
          },
        },
      ],
    ],
  };
}
