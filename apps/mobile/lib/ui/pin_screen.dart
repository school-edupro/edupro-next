import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:local_auth/local_auth.dart';
import 'package:material_ui/material_ui.dart';

import '../auth/auth_controller.dart';
import '../l10n/strings.dart';
import '../theme/tokens.g.dart';
import 'widgets.dart';

/// The app PIN: chosen after the first sign-in (`setting: true`), asked when the app opens (or the fingerprint /
/// face, when the phone has one set up).
class PinScreen extends ConsumerStatefulWidget {
  const PinScreen({super.key, required this.setting});
  final bool setting;

  @override
  ConsumerState<PinScreen> createState() => _PinScreenState();
}

class _PinScreenState extends ConsumerState<PinScreen> {
  final _pin = TextEditingController();
  final _again = TextEditingController();
  final _auth = LocalAuthentication();
  String? _error;
  bool _biometric = false;

  @override
  void initState() {
    super.initState();
    if (!widget.setting && !kIsWeb) {
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

  @override
  void dispose() {
    _pin.dispose();
    _again.dispose();
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

  Future<void> _submit() async {
    final s = ref.read(stringsProvider);
    final c = ref.read(authProvider.notifier);
    if (widget.setting) {
      if (!RegExp(r'^\d{4,6}$').hasMatch(_pin.text)) return setState(() => _error = s.pinHelp);
      if (_pin.text != _again.text) return setState(() => _error = s.pinMismatch);
      await c.setPin(_pin.text);
    } else {
      await c.unlock(pin: _pin.text);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final auth = ref.watch(authProvider);
    final error = _error ?? (auth is AuthLocked && auth.error == 'wrongPin' ? s.wrongPin : null);
    InputDecoration field(String label) => InputDecoration(labelText: label, counterText: '');
    return BrandedPage(
      title: widget.setting ? s.pinTitle : s.unlockTitle,
      children: [
        if (widget.setting) Text(s.pinHelp, style: Theme.of(context).textTheme.bodyLarge),
        const SizedBox(height: Tokens.sp4),
        TextField(
          key: const Key('pin'),
          controller: _pin,
          autofocus: true,
          obscureText: true,
          keyboardType: TextInputType.number,
          maxLength: 6,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          decoration: field(s.pinLabel),
          onSubmitted: (_) => widget.setting ? null : _submit(),
        ),
        if (widget.setting) ...[
          const SizedBox(height: Tokens.sp3),
          TextField(
            key: const Key('pinAgain'),
            controller: _again,
            obscureText: true,
            keyboardType: TextInputType.number,
            maxLength: 6,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            decoration: field(s.pinAgain),
            onSubmitted: (_) => _submit(),
          ),
        ],
        if (error != null) ...[const SizedBox(height: Tokens.sp3), ErrorText(error)],
        const SizedBox(height: Tokens.sp5),
        FilledButton(
          key: const Key('pinSubmit'),
          onPressed: _submit,
          child: Text(widget.setting ? s.pinSave : s.unlock),
        ),
        if (_biometric) ...[
          const SizedBox(height: Tokens.sp3),
          OutlinedButton.icon(
            onPressed: _useBiometric,
            icon: const Icon(Icons.fingerprint),
            label: Text(s.useBiometric),
          ),
        ],
        if (!widget.setting) ...[
          const SizedBox(height: Tokens.sp3),
          TextButton(
            onPressed: () => ref.read(authProvider.notifier).signOut(),
            child: Text(s.forgotPin),
          ),
        ],
      ],
    );
  }
}
