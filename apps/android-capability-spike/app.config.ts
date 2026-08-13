import type { ConfigContext, ExpoConfig } from 'expo/config';

const blockedPermissions = [
  'android.permission.INTERNET',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  return {
    ...config,
    name: 'Life Book Android Capability Spike',
    slug: 'life-book-android-capability-spike',
    version: '0.0.0',
    platforms: ['android'],
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    scheme: 'lifebook-capability-spike',
    updates: {
      enabled: false,
    },
    android: {
      allowBackup: false,
      blockedPermissions,
      package: 'dev.lifebook.capabilityspike',
      permissions: [
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.SCHEDULE_EXACT_ALARM',
        'android.permission.USE_BIOMETRIC',
        'android.permission.VIBRATE',
      ],
      intentFilters: [
        {
          action: 'VIEW',
          autoVerify: false,
          category: ['BROWSABLE', 'DEFAULT'],
          data: [
            {
              scheme: 'lifebook-capability-spike',
              host: 'probe',
            },
          ],
        },
      ],
    },
    plugins: [
      [
        'expo-build-properties',
        {
          android: {
            buildToolsVersion: '36.0.0',
            compileSdkVersion: 36,
            minSdkVersion: 29,
            targetSdkVersion: 36,
            useHermesV1: true,
          },
        },
      ],
      [
        'expo-sqlite',
        {
          enableFTS: true,
          useSQLCipher: true,
        },
      ],
      'expo-secure-store',
      'expo-local-authentication',
      'expo-notifications',
    ],
  };
}
