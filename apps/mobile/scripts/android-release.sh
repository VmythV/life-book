#!/bin/sh
# 打一个日常使用的 Android 安装包：不依赖 Metro，连 LIFE_BOOK_API_URL 指定的服务端。
# 不设置时用这台 Mac 当前 Wi-Fi（en0）的地址；装好后也可以在登录页修改服务器地址。
set -e
cd "$(dirname "$0")/.."

if [ -z "$LIFE_BOOK_API_URL" ]; then
  ip=$(ipconfig getifaddr en0 2>/dev/null || true)
  if [ -z "$ip" ]; then
    echo "找不到本机局域网地址，请设置 LIFE_BOOK_API_URL，如 http://192.168.1.5:8787" >&2
    exit 1
  fi
  LIFE_BOOK_API_URL="http://$ip:8787"
fi
export LIFE_BOOK_VARIANT=release
export LIFE_BOOK_API_URL
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
echo "服务端地址：$LIFE_BOOK_API_URL"

# android/ 由配置生成；开发版和日常使用版的包名不同，切换时要重新生成。
npx expo prebuild --platform android --clean --no-install
# 现在的手机基本都是 arm64，只打这一种架构，安装包小很多；需要时用 LIFE_BOOK_ANDROID_ABIS 覆盖。
(cd android && ./gradlew assembleRelease -PreactNativeArchitectures="${LIFE_BOOK_ANDROID_ABIS:-arm64-v8a}")
echo "安装包：$(pwd)/android/app/build/outputs/apk/release/app-release.apk"
