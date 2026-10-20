import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * 两种安装包可以同时装在手机上：
 * - 开发版（默认）：连 Metro 热更新，包名带 `.dev`；
 * - 日常使用版（`LIFE_BOOK_VARIANT=release`）：独立运行，连 `LIFE_BOOK_API_URL` 指定的服务端。
 */
const isRelease = process.env.LIFE_BOOK_VARIANT === 'release';
const appId = isRelease ? 'dev.lifebook.app' : 'dev.lifebook.app.dev';

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  return {
    ...config,
    name: isRelease ? '生活有谱' : '生活有谱开发版',
    slug: 'life-book',
    scheme: isRelease ? 'lifebook' : 'lifebook-dev',
    version: '0.0.0',
    platforms: ['ios', 'android'],
    orientation: 'portrait',
    // 图标的 SVG 源文件在 assets/source/，修改后重新导出 PNG。
    icon: './assets/icon.png',
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: appId,
      supportsTablet: false,
    },
    android: {
      package: appId,
      adaptiveIcon: {
        foregroundImage: './assets/adaptive-icon.png',
        monochromeImage: './assets/monochrome-icon.png',
        backgroundColor: '#176B5B',
      },
      allowBackup: false,
      predictiveBackGestureEnabled: true,
      // 用精确闹钟安排提醒，否则系统省电时可能推迟。Android 13 起 USE_EXACT_ALARM 安装即授予，
      // 12 及以下用 SCHEDULE_EXACT_ALARM（见 D-023）。
      permissions: [
        'android.permission.SCHEDULE_EXACT_ALARM',
        'android.permission.USE_EXACT_ALARM',
      ],
    },
    extra: {
      // 不设置时，开发构建会自动使用运行 Metro 的电脑的局域网地址。
      apiUrl: process.env.LIFE_BOOK_API_URL,
    },
    plugins: [
      'expo-router',
      'expo-secure-store',
      [
        'expo-notifications',
        { icon: './assets/notification-icon.png', color: '#176B5B' },
      ],
      [
        'expo-build-properties',
        {
          android: {
            minSdkVersion: 29,
            compileSdkVersion: 36,
            targetSdkVersion: 36,
            buildToolsVersion: '36.0.0',
            // 服务端目前跑在局域网里的电脑上，只有 HTTP。部署并启用 HTTPS 后去掉。
            usesCleartextTraffic: true,
          },
        },
      ],
    ],
  };
}
