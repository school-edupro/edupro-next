import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import 'auth/auth_controller.dart';
import 'l10n/strings.dart';
import 'theme/theme.dart';
import 'ui/home_shell.dart';
import 'ui/pin_screen.dart';
import 'ui/settings_screen.dart';
import 'ui/sign_in_screen.dart';
import 'ui/web_page_screen.dart';

/// Where each sign-in state belongs.
String? _gate(AuthState auth, String path) {
  final open = switch (auth) {
    AuthStarting() => '/starting',
    AuthSignedOut() || AuthCodeSent() => '/sign-in',
    AuthNeedsPin() => '/pin/set',
    AuthLocked() => '/pin',
    AuthSignedIn() => null,
  };
  if (open != null) return path == open ? null : open;
  // signed in: the sign-in pages lead home
  return ['/starting', '/sign-in', '/pin', '/pin/set'].contains(path) ? '/' : null;
}

final routerProvider = Provider<GoRouter>((ref) {
  final refresh = ValueNotifier<int>(0);
  ref.listen(authProvider, (_, _) => refresh.value++);
  ref.onDispose(refresh.dispose);
  return GoRouter(
    initialLocation: '/starting',
    refreshListenable: refresh,
    redirect: (_, state) => _gate(ref.read(authProvider), state.uri.path),
    routes: [
      GoRoute(
        path: '/starting',
        builder: (_, _) => const Scaffold(body: Center(child: CircularProgressIndicator())),
      ),
      GoRoute(path: '/sign-in', builder: (_, _) => const SignInScreen()),
      GoRoute(path: '/pin', builder: (_, _) => const PinScreen(setting: false)),
      GoRoute(path: '/pin/set', builder: (_, _) => const PinScreen(setting: true)),
      GoRoute(path: '/', builder: (_, _) => const HomeShell()),
      GoRoute(path: '/settings', builder: (_, _) => const SettingsScreen()),
      GoRoute(
        path: '/web',
        builder: (_, st) => WebPageScreen(
          app: st.uri.queryParameters['app'] == 'teacher' ? 'teacher' : 'parent',
          to: st.uri.queryParameters['to'] ?? '/',
          title: st.uri.queryParameters['title'] ?? 'EduPro',
        ),
      ),
    ],
  );
});

/// The design system's web fonts (off in tests, which have no network).
final webFontsProvider = Provider<bool>((ref) => true);

class EduProApp extends ConsumerStatefulWidget {
  const EduProApp({super.key});

  @override
  ConsumerState<EduProApp> createState() => _EduProAppState();
}

class _EduProAppState extends ConsumerState<EduProApp> {
  @override
  void initState() {
    super.initState();
    ref.read(authProvider.notifier).init();
  }

  @override
  Widget build(BuildContext context) {
    final hindi = ref.watch(hindiProvider);
    return MaterialApp.router(
      title: 'EduPro',
      debugShowCheckedModeBanner: false,
      theme: eduproTheme(brightness: Brightness.light, webFonts: ref.watch(webFontsProvider)),
      darkTheme: eduproTheme(brightness: Brightness.dark, webFonts: ref.watch(webFontsProvider)),
      locale: Locale(hindi ? 'hi' : 'en'),
      supportedLocales: const [Locale('en'), Locale('hi')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      routerConfig: ref.watch(routerProvider),
    );
  }
}
