APPNAME=Scorpion Critters Solitaire
APPID=com.pdemia.scorpioncritterssolitaire
LOGO=./scs.png
WEBVIEW=https://pdemia.com/scs/

# Build output: apk | aab | both
OUTPUT=apk

# true = generate one APK per ABI (much smaller each)
APK_SPLIT_PER_ABI=true

# APK target ABI:
# arm64-v8a (recommended for latest Android), armeabi-v7a, x86_64, or all
APK_TARGET_ABI=arm64-v8a

# true = obfuscate Dart code and split debug symbols (slightly smaller release build)
ENABLE_OBFUSCATION=true

# Output folder for generated release artifacts
RELEASE_DIR=./release

# Flutter project folder generated/used by script
PROJECT_DIR=./generated_app

# WebView/UI behavior
# ORIENTATION: portrait | landscape | system
ORIENTATION=portrait
ENABLE_ZOOM=false
ENABLE_DEBUG_LOGS=false
SHOW_LOADING_BAR=true
ALLOW_BACK_NAVIGATION=true

# Optional custom WebView user-agent (leave blank for default)
USER_AGENT=
