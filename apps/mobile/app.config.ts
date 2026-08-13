import type { ConfigContext, ExpoConfig } from 'expo/config';

const m0ReleaseBlockedPermissions = [
  'android.permission.INTERNET',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.VIBRATE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  const scaffoldApplicationId = process.env.LIFE_BOOK_CNG_APPLICATION_ID;
  const buildProfile = process.env.LIFE_BOOK_BUILD_PROFILE;
  if (
    scaffoldApplicationId !== undefined &&
    scaffoldApplicationId !== 'dev.lifebook.scaffold'
  ) {
    throw new Error(
      'LIFE_BOOK_CNG_APPLICATION_ID must use the reviewed M0 synthetic ID.',
    );
  }
  if (buildProfile !== undefined && buildProfile !== 'release') {
    throw new Error('LIFE_BOOK_BUILD_PROFILE must be release when it is set.');
  }

  return {
    ...config,
    name: '生活有谱',
    slug: 'life-book',
    version: '0.0.0',
    platforms: ['android'],
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    updates: {
      enabled: false,
    },
    android: {
      allowBackup: false,
      predictiveBackGestureEnabled: true,
      ...(buildProfile === 'release'
        ? { blockedPermissions: m0ReleaseBlockedPermissions }
        : {}),
      ...(scaffoldApplicationId === undefined ? {} : { package: scaffoldApplicationId }),
    },
    plugins: [
      [
        'expo-build-properties',
        {
          android: {
            useHermesV1: true,
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
