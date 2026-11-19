import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/api_transport.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../theme/tokens.g.dart';

/// The school this phone signs in to: its name and logo, remembered after a sign-in (the school of the profile in
/// use) and shown on the sign-in, code and PIN screens from then on. A phone that has never signed in shows the
/// EduPro mark: the code screen of a first sign-in does not name the school, so a number typed in does not tell a
/// stranger which school it belongs to.
class SchoolBrand {
  const SchoolBrand({required this.code, required this.name, this.logo, this.noLogo = false});

  final String code;
  final String name;
  final Uint8List? logo;

  /// the school has no logo (asked once; asked again only for another school)
  final bool noLogo;

  Map<String, Object?> toJson() => {
    'code': code,
    'name': name,
    if (logo != null) 'logo': base64Encode(logo!),
    if (noLogo) 'noLogo': true,
  };

  static SchoolBrand? fromJson(Object? j) {
    if (j is! Map || j['code'] is! String || j['name'] is! String) return null;
    Uint8List? logo;
    try {
      logo = j['logo'] is String ? base64Decode(j['logo'] as String) : null;
    } catch (_) {
      logo = null;
    }
    return SchoolBrand(
      code: j['code'] as String,
      name: j['name'] as String,
      logo: logo,
      noLogo: j['noLogo'] == true,
    );
  }
}

class SchoolBrandController extends Notifier<SchoolBrand?> {
  static const key = 'school.brand';

  /// A logo bigger than this is not kept on the phone (the EduPro mark shows instead).
  static const maxLogoBytes = 512 * 1024;

  @override
  SchoolBrand? build() {
    _load();
    return null;
  }

  Future<void> _load() async {
    try {
      final raw = (await SharedPreferences.getInstance()).getString(key);
      if (raw != null && state == null) state = SchoolBrand.fromJson(jsonDecode(raw));
    } catch (_) {
      // nothing kept: the EduPro mark
    }
  }

  /// The profile in use after a sign-in: its school's name, and its logo fetched once (the school's public logo).
  Future<void> remember({required String? code, required String name}) async {
    if (code == null || code.isEmpty) return;
    final have = state;
    final same = have != null && have.code == code;
    if (same && have.name == name && (have.logo != null || have.noLogo)) return;
    var logo = same ? have.logo : null;
    var noLogo = same && have.noLogo;
    if (logo == null && !noLogo) {
      try {
        final r = await ref.read(apiProvider).publicSchoolLogo(schoolCode: code);
        final bytes = r is Map ? base64Decode('${r['base64']}') : null;
        if (bytes != null && bytes.isNotEmpty && bytes.length <= maxLogoBytes) {
          logo = bytes;
        } else {
          noLogo = true;
        }
      } on ApiException catch (e) {
        // no logo (404): asked once; no network: asked again next time
        noLogo = e.status == 404;
      } catch (_) {
        noLogo = true;
      }
    }
    final b = SchoolBrand(code: code, name: name, logo: logo, noLogo: noLogo);
    state = b;
    try {
      await (await SharedPreferences.getInstance()).setString(key, jsonEncode(b.toJson()));
    } catch (_) {
      // shown now; asked again next time
    }
  }
}

final schoolBrandProvider = NotifierProvider<SchoolBrandController, SchoolBrand?>(
  SchoolBrandController.new,
);

/// EduPro's own mark: a navy square, "E" in white and "P" in cyan (the web app's icon).
class EduProMark extends StatelessWidget {
  const EduProMark({super.key, this.size = 72});
  final double size;

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'EduPro',
    image: true,
    excludeSemantics: true,
    child: Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: Tokens.mobNavy800,
        borderRadius: BorderRadius.circular(size * 0.25),
      ),
      child: Text.rich(
        TextSpan(
          children: const [
            TextSpan(
              text: 'E',
              style: TextStyle(color: Tokens.mobWhite),
            ),
            TextSpan(
              text: 'P',
              style: TextStyle(color: Tokens.mobCyan600),
            ),
          ],
          style: TextStyle(
            fontFamily: Theme.of(context).textTheme.titleLarge?.fontFamily,
            fontWeight: Tokens.fwSemibold,
            fontSize: size * 0.42,
            height: 1,
          ),
        ),
      ),
    ),
  );
}

/// The school's logo on a white circle (the EduPro mark until the phone knows the school).
class SchoolMark extends ConsumerWidget {
  const SchoolMark({super.key, this.size = 112});
  final double size;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final brand = ref.watch(schoolBrandProvider);
    final s = ref.watch(stringsProvider);
    final mark = EduProMark(size: size * 0.64);
    return Container(
      key: const Key('schoolMark'),
      width: size,
      height: size,
      padding: EdgeInsets.all(size * (brand?.logo == null ? 0 : 0.13)),
      alignment: Alignment.center,
      decoration: const BoxDecoration(color: Tokens.mobWhite, shape: BoxShape.circle),
      child: brand?.logo == null
          ? mark
          : ClipOval(
              child: Image.memory(
                brand!.logo!,
                key: const Key('schoolLogo'),
                fit: BoxFit.contain,
                semanticLabel: s.schoolLogo(brand.name),
                errorBuilder: (_, _, _) => mark,
              ),
            ),
    );
  }
}

/// "Powered by" and Mobilise's logo, at the foot of the sign-in, code and PIN screens.
class PoweredBy extends ConsumerWidget {
  const PoweredBy({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final logo = Image.asset(
      'assets/brand/mobilise-logo.png',
      height: 22,
      semanticLabel: 'Mobilise',
      errorBuilder: (_, _, _) => const Text('Mobilise'),
    );
    // a wrap, not a row: with large text the logo goes under the words rather than off the screen
    return Wrap(
      key: const Key('poweredBy'),
      alignment: WrapAlignment.center,
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: Tokens.sp2,
      runSpacing: Tokens.sp1,
      children: [
        Text(
          s.poweredBy,
          style: TextStyle(fontSize: 13, color: dark ? Tokens.mobGray300 : Tokens.mobGray500),
        ),
        // the logo's navy words need a light ground in dark mode
        dark
            ? Container(
                padding: const EdgeInsets.symmetric(horizontal: Tokens.sp2, vertical: Tokens.sp1),
                decoration: BoxDecoration(
                  color: Tokens.mobWhite,
                  borderRadius: BorderRadius.circular(Tokens.radiusSm),
                ),
                child: logo,
              )
            : logo,
      ],
    );
  }
}

/// A round button on the navy band (back, settings, approvals).
class BandIconButton extends StatelessWidget {
  const BandIconButton({
    super.key,
    required this.icon,
    required this.tooltip,
    required this.onPressed,
    this.badge,
  });
  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;
  final int? badge;

  @override
  Widget build(BuildContext context) {
    final b = badge ?? 0;
    return IconButton(
      tooltip: tooltip,
      onPressed: onPressed,
      style: IconButton.styleFrom(
        backgroundColor: Tokens.mobNavy700,
        foregroundColor: Tokens.mobWhite,
        minimumSize: const Size(48, 48),
      ),
      icon: Badge(
        isLabelVisible: b > 0,
        // white badge, navy number: red on navy is too dark (3.3:1)
        backgroundColor: Tokens.mobWhite,
        textColor: Tokens.mobNavy800,
        label: Text('$b'),
        child: Icon(icon),
      ),
    );
  }
}

/// English ⇄ हिन्दी on the navy band of the sign-in screens.
class LanguagePill extends ConsumerWidget {
  const LanguagePill({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final hindi = ref.watch(hindiProvider);
    return Semantics(
      button: true,
      label: s.otherLanguageHelp,
      excludeSemantics: true,
      child: OutlinedButton.icon(
        key: const Key('languagePill'),
        onPressed: () => ref.read(hindiProvider.notifier).set(!hindi),
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(48, 44),
          backgroundColor: Tokens.mobNavy700,
          foregroundColor: Tokens.mobWhite,
          side: const BorderSide(color: Tokens.mobNavy600),
          shape: const StadiumBorder(),
        ),
        icon: const Icon(Icons.language, size: 18),
        label: Text(s.otherLanguage),
      ),
    );
  }
}

/// The sign-in, code and PIN screens: the navy band with the school's logo and name (EduPro until the phone knows
/// the school), a light sheet with the form, and "Powered by Mobilise" at its foot.
class BandScaffold extends ConsumerWidget {
  const BandScaffold({
    super.key,
    required this.children,
    this.leading,
    this.trailing,
    this.compact = false,
  });
  final List<Widget> children;
  final Widget? leading;
  final Widget? trailing;

  /// a smaller logo (the code and PIN screens, which need the room)
  final bool compact;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final brand = ref.watch(schoolBrandProvider);
    final theme = Theme.of(context);
    final band = Column(
      children: [
        if (leading != null || trailing != null)
          Row(
            children: [leading ?? const SizedBox(), const Spacer(), trailing ?? const SizedBox()],
          ),
        SizedBox(height: compact ? Tokens.sp3 : Tokens.sp5),
        SchoolMark(size: compact ? 88 : 112),
        const SizedBox(height: Tokens.sp3),
        Text(
          brand?.name ?? 'EduPro',
          key: const Key('bandSchoolName'),
          textAlign: TextAlign.center,
          style: theme.textTheme.titleLarge?.copyWith(
            color: Tokens.mobWhite,
            fontWeight: Tokens.fwSemibold,
            fontSize: compact ? 19 : 22,
          ),
        ),
        if (brand == null && !compact) ...[
          const SizedBox(height: Tokens.sp1),
          Text(
            s.tagline,
            textAlign: TextAlign.center,
            style: const TextStyle(color: Tokens.mobNavy100, fontSize: 15),
          ),
        ],
      ],
    );
    return Scaffold(
      backgroundColor: Tokens.mobNavy800,
      body: SafeArea(
        bottom: false,
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 520),
            child: CustomScrollView(
              slivers: [
                SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(
                      Tokens.sp4,
                      Tokens.sp3,
                      Tokens.sp4,
                      compact ? Tokens.sp5 : Tokens.sp6,
                    ),
                    child: band,
                  ),
                ),
                SliverFillRemaining(
                  hasScrollBody: false,
                  child: Container(
                    padding: const EdgeInsets.fromLTRB(
                      Tokens.sp5,
                      Tokens.sp5 + Tokens.sp1,
                      Tokens.sp5,
                      Tokens.sp5,
                    ),
                    decoration: BoxDecoration(
                      color: theme.colorScheme.surface,
                      borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
                    ),
                    child: SafeArea(
                      top: false,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          ...children,
                          const Spacer(),
                          const SizedBox(height: Tokens.sp5),
                          const Divider(),
                          const SizedBox(height: Tokens.sp4),
                          const PoweredBy(),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The title of a sign-in sheet and the line under it.
class SheetHeading extends StatelessWidget {
  const SheetHeading({super.key, required this.title, this.lead});
  final String title;
  final String? lead;

  @override
  Widget build(BuildContext context) {
    final t = Theme.of(context).textTheme;
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          header: true,
          child: Text(
            title,
            style: t.headlineSmall?.copyWith(
              fontWeight: Tokens.fwSemibold,
              fontSize: 22,
              color: dark ? Tokens.mobWhite : Tokens.mobNavy800,
            ),
          ),
        ),
        if (lead != null) ...[const SizedBox(height: Tokens.sp1), Text(lead!, style: t.bodyLarge)],
      ],
    );
  }
}
