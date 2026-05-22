import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';

const String kWebviewUrl = 'https://pdemia.com/scs/';
const String kAppTitle = 'JustSimpleBlocks';
const bool kEnableZoom = false;
const bool kEnableDebugLogs = false;
const bool kShowLoadingBar = true;
const bool kAllowBackNavigation = true;
const String kOrientation = 'portrait';
const String kUserAgent = r'''''';

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
