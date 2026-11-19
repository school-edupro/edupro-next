import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../auth/auth_controller.dart';
import '../l10n/strings.dart';
import '../theme/tokens.g.dart';
import 'widgets.dart';

/// Sign-in: the mobile number, e-mail or admission number, then the 6-digit code.
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _login = TextEditingController();
  final _code = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _login.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() f) async {
    setState(() => _busy = true);
    try {
      await f();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// An error key of the app's own, or the API's sentence.
  String _message(S s, String e) => switch (e) {
    'enterLogin' => s.enterLogin,
    'codeSix' => s.codeSix,
    _ => e,
  };

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final auth = ref.watch(authProvider);
    final c = ref.read(authProvider.notifier);
    final code = auth is AuthCodeSent ? auth : null;
    final error = switch (auth) {
      AuthSignedOut(:final error) => error,
      AuthCodeSent(:final error) => error,
      _ => null,
    };
    return BrandedPage(
      title: code == null ? s.signInTitle : s.codeTitle,
      children: [
        if (code == null) ...[
          Text(s.signInHelp, style: Theme.of(context).textTheme.bodyLarge),
          const SizedBox(height: Tokens.sp4),
          TextField(
            key: const Key('login'),
            controller: _login,
            autofillHints: const [AutofillHints.telephoneNumber, AutofillHints.email],
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.go,
            decoration: InputDecoration(labelText: s.loginLabel),
            onSubmitted: (_) => _run(() => c.start(_login.text)),
          ),
        ] else ...[
          Text(
            code.sentTo != null ? s.codeSentTo(code.sentTo!) : s.codeSent,
            style: Theme.of(context).textTheme.bodyLarge,
          ),
          if (code.screenCode != null) ...[
            const SizedBox(height: Tokens.sp2),
            Notice(text: s.codeOnScreen(code.screenCode!)),
          ],
          const SizedBox(height: Tokens.sp4),
          TextField(
            key: const Key('code'),
            controller: _code,
            autofocus: true,
            autofillHints: const [AutofillHints.oneTimeCode],
            keyboardType: TextInputType.number,
            maxLength: 6,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: InputDecoration(labelText: s.codeLabel, counterText: ''),
            onSubmitted: (_) => _run(() => c.verify(_code.text)),
          ),
        ],
        if (error != null) ...[const SizedBox(height: Tokens.sp3), ErrorText(_message(s, error))],
        const SizedBox(height: Tokens.sp5),
        FilledButton(
          key: const Key('primary'),
          onPressed: _busy
              ? null
              : () => _run(() => code == null ? c.start(_login.text) : c.verify(_code.text)),
          child: Text(code == null ? s.sendCode : s.verify),
        ),
        if (code != null) ...[
          const SizedBox(height: Tokens.sp3),
          TextButton(onPressed: _busy ? null : () => _run(c.resend), child: Text(s.resend)),
          TextButton(onPressed: _busy ? null : c.back, child: Text(s.changeLogin)),
        ],
        const SizedBox(height: Tokens.sp5),
        const LanguageSwitch(),
      ],
    );
  }
}
