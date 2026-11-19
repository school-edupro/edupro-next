import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:local_auth/local_auth.dart';
import 'package:material_ui/material_ui.dart';

import '../app_services.dart';
import '../auth/auth_controller.dart';
import '../l10n/strings.dart';
import '../theme/tokens.g.dart';
import 'brand.dart';
import 'widgets.dart';

/// The app PIN on a number pad: chosen after the first sign-in (`setting: true`: 4 to 6 digits, then the same
/// again), asked when the app opens (it opens on the PIN's last digit; or the fingerprint / face when the phone has
/// one set up). A computer's keyboard types into it too.
class PinScreen extends ConsumerStatefulWidget {
  const PinScreen({super.key, required this.setting});
  final bool setting;

  @override
  ConsumerState<PinScreen> createState() => _PinScreenState();
}

class _PinScreenState extends ConsumerState<PinScreen> {
  final _auth = LocalAuthentication();
  final _focus = FocusNode();
  String _typed = '';

  /// setting: the PIN chosen in the first step (null while choosing)
  String? _first;
  String? _error;
  bool _biometric = false;
  bool _busy = false;

  /// unlocking: how many digits the PIN has (null for a PIN set before the length was kept: an Open button)
  int? _length;

  @override
  void initState() {
    super.initState();
    if (!widget.setting) {
      ref.read(sessionStoreProvider).pinLength.then((n) {
        if (mounted) setState(() => _length = n);
      });
      if (!kIsWeb) {
        _auth.canCheckBiometrics
            .then((v) {
              if (mounted && v) {
                setState(() => _biometric = true);
                _useBiometric();
              }
            })
            .catchError((_) {});
      }
    }
  }

  @override
  void dispose() {
    _focus.dispose();
    super.dispose();
  }

  Future<void> _useBiometric() async {
    final s = ref.read(stringsProvider);
    try {
      final ok = await _auth.authenticate(localizedReason: s.biometricReason);
      if (ok) await ref.read(authProvider.notifier).unlock(biometric: true);
    } catch (_) {
      // the PIN stays
    }
  }

  /// How many dots: the PIN's length when it is known, else as many as typed (at least 4).
  int get _slots {
    if (widget.setting && _first != null) return _first!.length;
    if (!widget.setting && _length != null) return _length!;
    return _typed.length < 4 ? 4 : (_typed.length > 6 ? 6 : _typed.length);
  }

  void _digit(String d) {
    if (_busy || _typed.length >= 6) return;
    if (_typed.length >= _slots && (_length != null || _first != null)) return;
    setState(() {
      _typed += d;
      _error = null;
    });
    if (!widget.setting && _length != null && _typed.length == _length) _open();
    if (widget.setting && _first != null && _typed.length == _first!.length) _save();
  }

  void _delete() {
    if (_busy || _typed.isEmpty) return;
    setState(() => _typed = _typed.substring(0, _typed.length - 1));
  }

  /// setting, first step: the chosen PIN, then the same again
  void _next() {
    final s = ref.read(stringsProvider);
    if (!RegExp(r'^\d{4,6}$').hasMatch(_typed)) return setState(() => _error = s.pinHelp);
    setState(() {
      _first = _typed;
      _typed = '';
      _error = null;
    });
  }

  Future<void> _save() async {
    final s = ref.read(stringsProvider);
    if (_typed != _first) {
      setState(() {
        _error = s.pinMismatch;
        _typed = '';
      });
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(authProvider.notifier).setPin(_typed);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _open() async {
    setState(() => _busy = true);
    try {
      await ref.read(authProvider.notifier).unlock(pin: _typed);
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          // a wrong PIN: the dots empty for another go
          if (ref.read(authProvider) is AuthLocked) _typed = '';
        });
      }
    }
  }

  KeyEventResult _key(FocusNode _, KeyEvent e) {
    if (e is! KeyDownEvent) return KeyEventResult.ignored;
    final ch = e.character;
    if (ch != null && RegExp(r'^\d$').hasMatch(ch)) {
      _digit(ch);
      return KeyEventResult.handled;
    }
    if (e.logicalKey == LogicalKeyboardKey.backspace) {
      _delete();
      return KeyEventResult.handled;
    }
    if (e.logicalKey == LogicalKeyboardKey.enter ||
        e.logicalKey == LogicalKeyboardKey.numpadEnter) {
      if (widget.setting && _first == null) _next();
      if (!widget.setting && _length == null && _typed.length >= 4) _open();
      return KeyEventResult.handled;
    }
    return KeyEventResult.ignored;
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final auth = ref.watch(authProvider);
    final error = _error ?? (auth is AuthLocked && auth.error == 'wrongPin' ? s.wrongPin : null);
    final choosing = widget.setting && _first == null;
    final title = widget.setting ? (choosing ? s.pinTitle : s.pinAgain) : s.unlockTitle;
    final lead = widget.setting ? (choosing ? s.pinHelp : null) : s.pinEnter;
    return Focus(
      focusNode: _focus,
      autofocus: true,
      onKeyEvent: _key,
      child: BandScaffold(
        compact: true,
        children: [
          Center(
            child: Column(
              children: [
                Semantics(
                  header: true,
                  child: Text(
                    title,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                      fontWeight: Tokens.fwSemibold,
                      fontSize: 22,
                      color: Theme.of(context).brightness == Brightness.dark
                          ? Tokens.mobWhite
                          : Tokens.mobNavy800,
                    ),
                  ),
                ),
                if (lead != null) ...[
                  const SizedBox(height: Tokens.sp1),
                  Text(lead, textAlign: TextAlign.center),
                ],
              ],
            ),
          ),
          const SizedBox(height: Tokens.sp5),
          PinDots(filled: _typed.length, of: _slots, label: s.pinDots(_typed.length, _slots)),
          if (error != null) ...[
            const SizedBox(height: Tokens.sp3),
            Center(child: ErrorText(error)),
          ],
          const SizedBox(height: Tokens.sp5),
          NumberPad(
            onDigit: _digit,
            onDelete: _delete,
            deleteLabel: s.deleteDigit,
            label: s.numberPad,
            extra: !widget.setting && _biometric
                ? IconButton(
                    key: const Key('pinBiometric'),
                    tooltip: s.useBiometric,
                    onPressed: _useBiometric,
                    style: IconButton.styleFrom(backgroundColor: Tokens.mobCyan100),
                    icon: const Icon(Icons.fingerprint, color: Tokens.mobNavy800, size: 28),
                  )
                : null,
          ),
          const SizedBox(height: Tokens.sp4),
          if (choosing)
            FilledButton(
              key: const Key('pinNext'),
              onPressed: _typed.length >= 4 ? _next : null,
              child: Text(s.next),
            ),
          if (widget.setting && !choosing)
            Center(
              child: TextButton(
                key: const Key('pinStartAgain'),
                onPressed: () => setState(() {
                  _first = null;
                  _typed = '';
                  _error = null;
                }),
                child: Text(s.startAgain),
              ),
            ),
          if (!widget.setting && _length == null)
            FilledButton(
              key: const Key('pinSubmit'),
              onPressed: _typed.length >= 4 && !_busy ? _open : null,
              child: Text(s.unlock),
            ),
          if (!widget.setting)
            Center(
              child: TextButton(
                onPressed: () => ref.read(authProvider.notifier).signOut(),
                child: Text(s.forgotPin),
              ),
            ),
        ],
      ),
    );
  }
}

/// The PIN's dots: filled for each digit typed.
class PinDots extends StatelessWidget {
  const PinDots({super.key, required this.filled, required this.of, required this.label});
  final int filled;
  final int of;
  final String label;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final ink = dark ? Tokens.mobWhite : Tokens.mobNavy800;
    return Semantics(
      key: const Key('pinDots'),
      label: label,
      liveRegion: true,
      excludeSemantics: true,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          for (var i = 0; i < of; i++)
            Container(
              width: 16,
              height: 16,
              margin: const EdgeInsets.symmetric(horizontal: 9),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: i < filled ? ink : null,
                border: i < filled ? null : Border.all(color: Tokens.mobGray400, width: 2),
              ),
            ),
        ],
      ),
    );
  }
}

/// 1–9, then [extra] (the fingerprint key), 0 and delete. Rows of keys, not a grid: the sign-in sheet measures its
/// content.
class NumberPad extends StatelessWidget {
  const NumberPad({
    super.key,
    required this.onDigit,
    required this.onDelete,
    required this.deleteLabel,
    required this.label,
    this.extra,
  });
  final ValueChanged<String> onDigit;
  final VoidCallback onDelete;
  final String deleteLabel;
  final String label;
  final Widget? extra;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    Widget key(String d) => Expanded(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: Tokens.sp2, vertical: 5),
        child: SizedBox(
          height: 56,
          child: TextButton(
            key: Key('pinKey-$d'),
            onPressed: () => onDigit(d),
            style: TextButton.styleFrom(
              backgroundColor: dark ? Tokens.mobGray900 : Tokens.mobGray50,
              foregroundColor: dark ? Tokens.mobWhite : Tokens.mobGray900,
              shape: const StadiumBorder(),
              textStyle: TextStyle(
                fontFamily: Theme.of(context).textTheme.titleLarge?.fontFamily,
                fontSize: 24,
                fontWeight: Tokens.fwMedium,
              ),
            ),
            child: Text(d),
          ),
        ),
      ),
    );
    Widget cell(Widget? child) => Expanded(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: Tokens.sp2, vertical: 5),
        child: SizedBox(height: 56, child: Center(child: child)),
      ),
    );
    return Semantics(
      label: label,
      container: true,
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 300),
          child: Column(
            children: [
              for (final row in const [
                ['1', '2', '3'],
                ['4', '5', '6'],
                ['7', '8', '9'],
              ])
                Row(children: [for (final d in row) key(d)]),
              Row(
                children: [
                  cell(extra),
                  key('0'),
                  cell(
                    IconButton(
                      key: const Key('pinDelete'),
                      tooltip: deleteLabel,
                      onPressed: onDelete,
                      icon: const Icon(Icons.backspace_outlined),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
