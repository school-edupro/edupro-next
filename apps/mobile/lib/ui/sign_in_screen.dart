import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../auth/auth_controller.dart';
import '../l10n/strings.dart';
import '../theme/tokens.g.dart';
import 'brand.dart';
import 'widgets.dart';

/// Sign-in: the mobile number, e-mail or admission number, then the 6-digit code — on the navy band with the
/// school's logo (EduPro on a phone that has not signed in yet) and "Powered by Mobilise" at the foot.
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

  void _back() {
    _code.clear();
    ref.read(authProvider.notifier).back();
  }

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
    final text = Theme.of(context).textTheme;
    return BandScaffold(
      compact: code != null,
      leading: code == null
          ? null
          : BandIconButton(
              icon: Icons.arrow_back,
              tooltip: s.changeLogin,
              onPressed: _busy ? null : _back,
            ),
      trailing: const LanguagePill(),
      children: [
        if (code == null) ...[
          SheetHeading(title: s.signInWelcome, lead: s.signInLead),
          const SizedBox(height: Tokens.sp5),
          TextField(
            key: const Key('login'),
            controller: _login,
            autofillHints: const [AutofillHints.telephoneNumber, AutofillHints.email],
            keyboardType: TextInputType.emailAddress,
            textInputAction: TextInputAction.go,
            decoration: InputDecoration(labelText: s.loginField),
            onSubmitted: (_) => _run(() => c.start(_login.text)),
          ),
          const SizedBox(height: Tokens.sp2),
          Text(
            s.signInHelp,
            // the muted grey is too faint on the dark sheet (3.7:1); a lighter grey there
            style: text.bodyMedium?.copyWith(
              color: Theme.of(context).brightness == Brightness.dark
                  ? Tokens.mobGray300
                  : Tokens.textMuted,
            ),
          ),
        ] else ...[
          SheetHeading(
            title: s.codeTitle,
            lead: code.sentTo != null ? s.codeSentTo(code.sentTo!) : s.codeSent,
          ),
          if (code.screenCode != null) ...[
            const SizedBox(height: Tokens.sp3),
            Notice(text: s.codeOnScreen(code.screenCode!)),
          ],
          const SizedBox(height: Tokens.sp5),
          CodeBoxes(
            fieldKey: const Key('code'),
            controller: _code,
            label: s.codeLabel,
            onCompleted: (v) {
              if (!_busy) _run(() => c.verify(v));
            },
          ),
        ],
        if (error != null) ...[const SizedBox(height: Tokens.sp3), ErrorText(_message(s, error))],
        const SizedBox(height: Tokens.sp5),
        FilledButton(
          key: const Key('primary'),
          onPressed: _busy
              ? null
              : () => _run(() => code == null ? c.start(_login.text) : c.verify(_code.text)),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Flexible(child: Text(code == null ? s.sendCode : s.verify)),
              if (code == null) ...[
                const SizedBox(width: Tokens.sp2),
                const Icon(Icons.arrow_forward, size: 20),
              ],
            ],
          ),
        ),
        if (code != null) ...[
          const SizedBox(height: Tokens.sp2),
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            children: [
              TextButton(onPressed: _busy ? null : () => _run(c.resend), child: Text(s.resend)),
              TextButton(onPressed: _busy ? null : _back, child: Text(s.changeLogin)),
            ],
          ),
        ],
      ],
    );
  }
}

/// The 6-digit code as six boxes over one real text field (the phone's code autofill, the keyboard and screen
/// readers use the field; the boxes only show what is typed). A full code is sent on its own.
class CodeBoxes extends StatefulWidget {
  const CodeBoxes({
    super.key,
    required this.controller,
    required this.label,
    this.fieldKey,
    this.onCompleted,
    this.length = 6,
  });
  final TextEditingController controller;
  final String label;
  final Key? fieldKey;
  final ValueChanged<String>? onCompleted;
  final int length;

  @override
  State<CodeBoxes> createState() => _CodeBoxesState();
}

class _CodeBoxesState extends State<CodeBoxes> {
  final _focus = FocusNode();

  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_changed);
    _focus.addListener(_changed);
  }

  @override
  void dispose() {
    widget.controller.removeListener(_changed);
    _focus.dispose();
    super.dispose();
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final text = widget.controller.text;
    final at = text.length.clamp(0, widget.length - 1);
    final digit = Theme.of(context).textTheme.headlineSmall?.copyWith(
      fontWeight: Tokens.fwSemibold,
      color: dark ? Tokens.mobWhite : Tokens.mobNavy800,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ExcludeSemantics(
          child: Text(
            widget.label,
            style: const TextStyle(fontWeight: Tokens.fwSemibold, fontSize: 15),
          ),
        ),
        const SizedBox(height: Tokens.sp2),
        // no LayoutBuilder here: the sign-in sheet measures its content (SliverFillRemaining)
        ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 380),
          child: Stack(
            children: [
              ExcludeSemantics(
                child: Row(
                  children: [
                    for (var i = 0; i < widget.length; i++)
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.symmetric(horizontal: Tokens.sp1),
                          child: Container(
                            height: 58,
                            alignment: Alignment.center,
                            decoration: BoxDecoration(
                              color: _focus.hasFocus && i == at && i >= text.length
                                  ? (dark ? Tokens.mobNavy900 : Tokens.mobWhite)
                                  : (dark ? Tokens.mobGray900 : Tokens.mobGray50),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color: _focus.hasFocus && i == at
                                    ? Tokens.mobCyan600
                                    : (dark ? Tokens.mobGray500 : Tokens.mobGray300),
                                width: _focus.hasFocus && i == at ? 2 : 1.5,
                              ),
                            ),
                            child: Text(i < text.length ? text[i] : '', style: digit),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
              // the real field, on top and see-through: taps, typing, autofill and the screen reader
              Positioned.fill(
                child: Opacity(
                  opacity: 0,
                  alwaysIncludeSemantics: true,
                  child: TextField(
                    key: widget.fieldKey,
                    controller: widget.controller,
                    focusNode: _focus,
                    autofocus: true,
                    autofillHints: const [AutofillHints.oneTimeCode],
                    keyboardType: TextInputType.number,
                    maxLength: widget.length,
                    showCursor: false,
                    enableInteractiveSelection: false,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                    decoration: InputDecoration(
                      labelText: widget.label,
                      counterText: '',
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      filled: false,
                    ),
                    onChanged: (v) {
                      if (v.length == widget.length) widget.onCompleted?.call(v);
                    },
                    onSubmitted: (v) => widget.onCompleted?.call(v),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
