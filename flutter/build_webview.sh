#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/config.md"

if ! command -v flutter >/dev/null 2>&1; then
  echo "Error: flutter is not installed or not in PATH."
  exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "Error: missing config file at $CONFIG_FILE"
  exit 1
fi

declare -A CFG
while IFS='=' read -r raw_key raw_val; do
  key="$(echo "${raw_key:-}" | sed 's/#.*$//' | xargs)"
  val="$(echo "${raw_val:-}" | sed 's/#.*$//' | sed 's/^ *//;s/ *$//')"
  [[ -z "$key" ]] && continue
  CFG["$key"]="$val"
done < "$CONFIG_FILE"

cfg() {
  local key="$1"
  local default_value="$2"
  if [[ -n "${CFG[$key]:-}" ]]; then
    echo "${CFG[$key]}"
  else
    echo "$default_value"
  fi
}

APP_NAME="$(cfg APPNAME "JustSimpleBlocks")"
APP_ID="$(cfg APPID "com.example.webviewapp")"
LOGO_PATH_RAW="$(cfg LOGO "./jsb.png")"
WEBVIEW_URL="$(cfg WEBVIEW "https://example.com")"
OUTPUT_TYPE="$(cfg OUTPUT "apk")"
APK_SPLIT_PER_ABI="$(cfg APK_SPLIT_PER_ABI "true")"
APK_TARGET_ABI="$(cfg APK_TARGET_ABI "arm64-v8a")"
ENABLE_OBFUSCATION="$(cfg ENABLE_OBFUSCATION "true")"
RELEASE_DIR_RAW="$(cfg RELEASE_DIR "./release")"
PROJECT_DIR_RAW="$(cfg PROJECT_DIR "./generated_app")"
ORIENTATION="$(cfg ORIENTATION "portrait")"
ENABLE_ZOOM="$(cfg ENABLE_ZOOM "false")"
ENABLE_DEBUG_LOGS="$(cfg ENABLE_DEBUG_LOGS "false")"
SHOW_LOADING_BAR="$(cfg SHOW_LOADING_BAR "true")"
USER_AGENT="$(cfg USER_AGENT "")"
ALLOW_BACK_NAVIGATION="$(cfg ALLOW_BACK_NAVIGATION "true")"

if [[ ! "$APP_ID" =~ ^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$ ]]; then
  echo "Error: APPID '$APP_ID' is invalid. Expected format like com.company.app"
  exit 1
fi

APP_ORG="${APP_ID%.*}"
APP_SUFFIX="${APP_ID##*.}"
PROJECT_NAME="$(echo "$APP_SUFFIX" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9_]/_/g')"
if [[ -z "$PROJECT_NAME" ]]; then
  PROJECT_NAME="webviewapp"
fi
if [[ "$PROJECT_NAME" =~ ^[0-9] ]]; then
  PROJECT_NAME="app_$PROJECT_NAME"
fi

LOGO_PATH="$(cd "$SCRIPT_DIR" && realpath "$LOGO_PATH_RAW")"
if [[ ! -f "$LOGO_PATH" ]]; then
  echo "Error: logo file not found at $LOGO_PATH"
  exit 1
fi

RELEASE_DIR="$(cd "$SCRIPT_DIR" && mkdir -p "$RELEASE_DIR_RAW" && realpath "$RELEASE_DIR_RAW")"
PROJECT_DIR="$(cd "$SCRIPT_DIR" && mkdir -p "$(dirname "$PROJECT_DIR_RAW")" && realpath -m "$PROJECT_DIR_RAW")"

if [[ ! -d "$PROJECT_DIR" ]]; then
  flutter create --platforms=android --org "$APP_ORG" "$PROJECT_DIR"
fi

mkdir -p "$PROJECT_DIR/assets"
cp "$LOGO_PATH" "$PROJECT_DIR/assets/icon.png"

cat > "$PROJECT_DIR/pubspec.yaml" <<EOF
name: $PROJECT_NAME
description: Lightweight WebView wrapper app.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ^3.4.0

dependencies:
  flutter:
    sdk: flutter
  webview_flutter: ^4.8.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^3.0.0
  flutter_launcher_icons: ^0.13.1

flutter:
  uses-material-design: true
  assets:
    - assets/icon.png

flutter_launcher_icons:
  android: true
  ios: false
  image_path: assets/icon.png
  adaptive_icon_background: "#FFFFFF"
  adaptive_icon_foreground: assets/icon.png
  min_sdk_android: 21
EOF

cat > "$PROJECT_DIR/lib/main.dart" <<EOF
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

const String kWebviewUrl = '${WEBVIEW_URL}';
const String kAppTitle = '${APP_NAME}';
const bool kEnableZoom = ${ENABLE_ZOOM};
const bool kEnableDebugLogs = ${ENABLE_DEBUG_LOGS};
const bool kShowLoadingBar = ${SHOW_LOADING_BAR};
const bool kAllowBackNavigation = ${ALLOW_BACK_NAVIGATION};
const String kOrientation = '${ORIENTATION}';
const String kUserAgent = r'''${USER_AGENT}''';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  if (kOrientation == 'portrait') {
    await SystemChrome.setPreferredOrientations([
      DeviceOrientation.portraitUp,
    ]);
  } else if (kOrientation == 'landscape') {
    await SystemChrome.setPreferredOrientations([
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
    ]);
  }

  runApp(const WebViewShellApp());
}

class WebViewShellApp extends StatelessWidget {
  const WebViewShellApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: kAppTitle,
      home: const WebViewPage(),
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: Colors.blue,
      ),
    );
  }
}

class WebViewPage extends StatefulWidget {
  const WebViewPage({super.key});

  @override
  State<WebViewPage> createState() => _WebViewPageState();
}

class _WebViewPageState extends State<WebViewPage> {
  late final WebViewController _controller;
  int _loadingProgress = 0;

  @override
  void initState() {
    super.initState();

    _controller = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(
        NavigationDelegate(
          onProgress: (progress) {
            if (!mounted) return;
            setState(() => _loadingProgress = progress);
          },
          onPageFinished: (_) {
            if (!mounted) return;
            setState(() => _loadingProgress = 100);
          },
        ),
      )
      ..loadRequest(Uri.parse(kWebviewUrl));

    if (_controller.platform is AndroidWebViewController) {
      final androidController = _controller.platform as AndroidWebViewController;
      androidController.setMediaPlaybackRequiresUserGesture(false);
      androidController.enableZoom(kEnableZoom);
      if (kEnableDebugLogs) {
        AndroidWebViewController.enableDebugging(true);
      }
    }

    if (kUserAgent.trim().isNotEmpty) {
      _controller.setUserAgent(kUserAgent);
    }
  }

  Future<bool> _onWillPop() async {
    if (!kAllowBackNavigation) {
      return true;
    }
    if (await _controller.canGoBack()) {
      await _controller.goBack();
      return false;
    }
    return true;
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvoked: (didPop) async {
        if (didPop) return;
        final shouldPop = await _onWillPop();
        if (shouldPop && mounted) {
          Navigator.of(context).maybePop();
        }
      },
      child: Scaffold(
        body: SafeArea(
          child: Column(
            children: [
              if (kShowLoadingBar && _loadingProgress < 100)
                LinearProgressIndicator(value: _loadingProgress / 100),
              Expanded(child: WebViewWidget(controller: _controller)),
            ],
          ),
        ),
      ),
    );
  }
}
EOF

MANIFEST_PATH="$PROJECT_DIR/android/app/src/main/AndroidManifest.xml"
if [[ -f "$MANIFEST_PATH" ]]; then
  sed -i "s/android:label=\"[^\"]*\"/android:label=\"$APP_NAME\"/" "$MANIFEST_PATH"

  if ! grep -q 'android.permission.INTERNET' "$MANIFEST_PATH"; then
    sed -i '/<manifest /a\    <uses-permission android:name="android.permission.INTERNET"/>' "$MANIFEST_PATH"
  fi

  if ! grep -q 'android.permission.ACCESS_NETWORK_STATE' "$MANIFEST_PATH"; then
    sed -i '/<manifest /a\    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>' "$MANIFEST_PATH"
  fi
fi

pushd "$PROJECT_DIR" >/dev/null
flutter pub get
flutter pub run flutter_launcher_icons

declare -a FLUTTER_RELEASE_FLAGS
if [[ "$ENABLE_OBFUSCATION" == "true" ]]; then
  mkdir -p "$RELEASE_DIR/symbols"
  FLUTTER_RELEASE_FLAGS+=(--obfuscate --split-debug-info="$RELEASE_DIR/symbols")
fi

build_apk() {
  case "$APK_TARGET_ABI" in
    all)
      if [[ "$APK_SPLIT_PER_ABI" == "true" ]]; then
        flutter build apk --release --split-per-abi "${FLUTTER_RELEASE_FLAGS[@]}"
        cp build/app/outputs/flutter-apk/app-armeabi-v7a-release.apk "$RELEASE_DIR/${PROJECT_NAME}-armeabi-v7a-release.apk" || true
        cp build/app/outputs/flutter-apk/app-arm64-v8a-release.apk "$RELEASE_DIR/${PROJECT_NAME}-arm64-v8a-release.apk" || true
        cp build/app/outputs/flutter-apk/app-x86_64-release.apk "$RELEASE_DIR/${PROJECT_NAME}-x86_64-release.apk" || true
      else
        flutter build apk --release "${FLUTTER_RELEASE_FLAGS[@]}"
        cp "build/app/outputs/flutter-apk/app-release.apk" "$RELEASE_DIR/${PROJECT_NAME}-release.apk"
      fi
      ;;
    arm64-v8a)
      flutter build apk --release --target-platform android-arm64 "${FLUTTER_RELEASE_FLAGS[@]}"
      cp "build/app/outputs/flutter-apk/app-release.apk" "$RELEASE_DIR/${PROJECT_NAME}-arm64-v8a-release.apk"
      ;;
    armeabi-v7a)
      flutter build apk --release --target-platform android-arm "${FLUTTER_RELEASE_FLAGS[@]}"
      cp "build/app/outputs/flutter-apk/app-release.apk" "$RELEASE_DIR/${PROJECT_NAME}-armeabi-v7a-release.apk"
      ;;
    x86_64)
      flutter build apk --release --target-platform android-x64 "${FLUTTER_RELEASE_FLAGS[@]}"
      cp "build/app/outputs/flutter-apk/app-release.apk" "$RELEASE_DIR/${PROJECT_NAME}-x86_64-release.apk"
      ;;
    *)
      echo "Error: APK_TARGET_ABI must be all, arm64-v8a, armeabi-v7a, or x86_64"
      exit 1
      ;;
  esac
}

case "$OUTPUT_TYPE" in
  apk)
    build_apk
    ;;
  aab)
    flutter build appbundle --release "${FLUTTER_RELEASE_FLAGS[@]}"
    cp "build/app/outputs/bundle/release/app-release.aab" "$RELEASE_DIR/${PROJECT_NAME}-release.aab"
    ;;
  both)
    build_apk
    flutter build appbundle --release "${FLUTTER_RELEASE_FLAGS[@]}"
    cp "build/app/outputs/bundle/release/app-release.aab" "$RELEASE_DIR/${PROJECT_NAME}-release.aab"
    ;;
  *)
    echo "Error: OUTPUT must be apk, aab, or both"
    exit 1
    ;;
esac
popd >/dev/null

echo "Build complete. Artifacts copied to: $RELEASE_DIR"