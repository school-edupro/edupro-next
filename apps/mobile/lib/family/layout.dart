import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/theme.dart';
import '../theme/tokens.g.dart';
import '../ui/home_shell.dart' show nativeScreen;
import 'assistant.dart' show openAssistant;
import '../ui/widgets.dart';
import 'common.dart';
import 'data.dart';

/// The words of the family app's layout (docs/design/90), in English and Hindi.
extension LayoutWords on S {
  String _l(String en, String hi) => hindi ? hi : en;

  String get layAll => _l('All', 'सभी');
  String get layEdit => _l('Edit', 'बदलें');
  String get layEditTitle => _l('Edit shortcuts', 'शॉर्टकट बदलें');
  String get layEditHelp => _l(
    'Your shortcuts on Home: 4 to 12 screens, in your order. The school’s set stays for everyone else.',
    'होम पर आपके शॉर्टकट: 4 से 12 स्क्रीन, आपके क्रम में। बाकी सबके लिए विद्यालय का सेट रहता है।',
  );
  String layChosen(int n) => _l('Your shortcuts ($n of 12)', 'आपके शॉर्टकट (12 में से $n)');
  String get layAdd => _l('Add a screen', 'स्क्रीन जोड़ें');
  String get layFind => _l('Find a screen', 'स्क्रीन खोजें');
  String get laySave => _l('Save', 'सहेजें');
  String get layReset => _l('Back to the school’s shortcuts', 'विद्यालय के शॉर्टकट पर लौटें');
  String get layNeedFour => _l('Choose at least 4 shortcuts.', 'कम से कम 4 शॉर्टकट चुनें।');
  String get layTwelve => _l('At most 12 shortcuts.', 'अधिकतम 12 शॉर्टकट।');
  String layUp(String x) => _l('Move $x up', '$x ऊपर करें');
  String layDown(String x) => _l('Move $x down', '$x नीचे करें');
  String layRemove(String x) => _l('Remove $x', '$x हटाएँ');
  String layAddX(String x) => _l('Add $x', '$x जोड़ें');
  String get layOwn => _l('Your own shortcuts', 'आपके अपने शॉर्टकट');
  String get layComingUp => _l('Coming up', 'आगे');
  String get layNothingComing => _l(
    'No holidays or events in the next 30 days.',
    'अगले 30 दिनों में कोई अवकाश या कार्यक्रम नहीं।',
  );
  String get layFeesDue => _l('Fees due', 'बकाया शुल्क');
  String get layPayNow => _l('To pay now', 'अभी देय');
  String get layNothingDue => _l('Nothing due now.', 'अभी कुछ बकाया नहीं।');
  String get layLibrary => _l('Library books', 'पुस्तकालय की पुस्तकें');
  String get layNoBooks => _l('No books out now.', 'अभी कोई पुस्तक नहीं ली गई।');
  String get layAcademics => _l('Academics', 'शिक्षा');
}

/// A screen of the layout: its path, name (English, put in Hindi by `s.menu`) and the web apps' icon name.
class FamilyEntry {
  const FamilyEntry(this.href, this.label, this.icon);
  factory FamilyEntry.fromJson(Json j) =>
      FamilyEntry('${j['href']}', '${j['label']}', '${j['icon'] ?? ''}');
  final String href;
  final String label;
  final String icon;
}

/// A Home card of the layout (a key of the catalogue, its name in both languages).
class FamilyCardEntry {
  const FamilyCardEntry(this.key, this.label, this.labelHi);
  final String key;
  final String label;
  final String labelHi;
}

/// The layout a person gets (`GET me/app-layout`): their rights applied, their own shortcuts when they kept any.
class FamilyLayoutView {
  const FamilyLayoutView({
    required this.tabs,
    required this.shortcuts,
    required this.ownShortcuts,
    required this.cards,
    required this.academics,
    required this.screens,
    this.hidden = const {},
  });

  factory FamilyLayoutView.fromJson(Json j) {
    List<FamilyEntry> list(String k) => [for (final x in asList(j[k])) FamilyEntry.fromJson(x)];
    return FamilyLayoutView(
      tabs: list('tabs'),
      shortcuts: list('shortcuts'),
      ownShortcuts: j['ownShortcuts'] == true,
      cards: [
        for (final c in asList(j['cards']))
          FamilyCardEntry('${c['key']}', '${c['label']}', '${c['labelHi'] ?? c['label']}'),
      ],
      academics: list('academics'),
      screens: list('screens'),
      hidden: {for (final h in (j['hidden'] as List?) ?? const []) '$h'},
    );
  }

  /// The app as it was before the school arranged it (no layout has come yet, offline the first time): the
  /// screens the menu has, else as written.
  factory FamilyLayoutView.fallback(Profile p, Set<String>? menu) {
    final student = p.kind == 'student';
    const academics = [
      FamilyEntry('/attendance', 'Attendance', 'check'),
      FamilyEntry('/homework', 'Homework', 'book'),
      FamilyEntry('/timetable', 'Timetable', 'calendar'),
      FamilyEntry('/date-sheet', 'Exam date sheet', 'calendar'),
      FamilyEntry('/results', 'Results', 'chart'),
      FamilyEntry('/calendar', 'Calendar', 'calendar'),
    ];
    final shortcuts = [
      const FamilyEntry('/attendance', 'Attendance', 'check'),
      const FamilyEntry('/homework', 'Homework', 'book'),
      const FamilyEntry('/timetable', 'Timetable', 'calendar'),
      student
          ? const FamilyEntry('/fees', 'Dues and receipts', 'wallet')
          : const FamilyEntry('/results', 'Results', 'chart'),
      const FamilyEntry('/calendar', 'Calendar', 'calendar'),
      const FamilyEntry('/date-sheet', 'Exam date sheet', 'calendar'),
      const FamilyEntry('/notices', 'Notices', 'bell'),
      !student && (menu?.contains('/queries') ?? false)
          ? const FamilyEntry('/queries', 'Queries', 'inbox')
          : const FamilyEntry('/messages', 'Messages', 'message'),
    ];
    return FamilyLayoutView(
      tabs: [
        const FamilyEntry('/', 'Home', 'home'),
        ...(student
            ? const [
                FamilyEntry('/homework', 'Homework', 'book'),
                FamilyEntry('/timetable', 'Timetable', 'calendar'),
                FamilyEntry('/results', 'Results', 'chart'),
              ]
            : const [
                FamilyEntry('academics', 'Academics', 'book'),
                FamilyEntry('/fees', 'Dues and receipts', 'wallet'),
                FamilyEntry('/messages', 'Messages', 'message'),
              ]),
        const FamilyEntry('more', 'More', 'grid'),
      ],
      shortcuts: shortcuts,
      ownShortcuts: false,
      cards: const [
        FamilyCardEntry('attendance_today', 'Attendance today', 'आज की उपस्थिति'),
        FamilyCardEntry('classes_today', "Today's classes", 'आज की कक्षाएँ'),
        FamilyCardEntry('homework_due', 'Homework due', 'बाकी गृहकार्य'),
        FamilyCardEntry('next_exam', 'Next exam', 'अगली परीक्षा'),
        FamilyCardEntry('notices', 'Latest notices', 'नवीनतम सूचनाएँ'),
      ],
      academics: academics,
      screens: const [],
    );
  }

  /// Home, the three the school chose, More.
  final List<FamilyEntry> tabs;
  final List<FamilyEntry> shortcuts;
  final bool ownShortcuts;
  final List<FamilyCardEntry> cards;
  final List<FamilyEntry> academics;

  /// Every screen the person may open (what "Edit shortcuts" offers).
  final List<FamilyEntry> screens;

  /// The screens the school hides from families (left out everywhere, Home's figures too).
  final Set<String> hidden;
}

/// The family layout of a profile, kept for offline use; the app as it was when none has come (or the call fails
/// with no copy kept).
final familyLayoutProvider = FutureProvider.family<FamilyLayoutView, Profile>((ref, p) async {
  // the layout first (the copy kept last time when there is no network); the menu only for the fallback
  try {
    final r = await cached(
      'layout:${p.id}',
      () =>
          ref.read(apiProvider).familyLayoutMine(kind: p.kind == 'student' ? 'student' : 'parent'),
    );
    final v = FamilyLayoutView.fromJson(asJson(r.data));
    if (v.tabs.length >= 2) return v;
  } catch (_) {
    // no layout and no copy: the app as it was
  }
  final menu = await ref
      .read(menuProvider(p.id).future)
      .then<Set<String>?>(
        (m) => {
          for (final g in m.groups)
            for (final i in g.items) i.href,
        },
      )
      .timeout(const Duration(seconds: 5))
      .catchError((_) => null);
  return FamilyLayoutView.fallback(p, menu);
});

/// A screen's own icon in the app (the shortcut tiles and the tabs); else the web apps' icon name.
IconData screenIcon(String href, [String icon = '']) => switch (href) {
  '/' => Icons.home_outlined,
  'more' => Icons.apps,
  'academics' => Icons.menu_book_outlined,
  '/attendance' => Icons.how_to_reg_outlined,
  '/homework' => Icons.menu_book_outlined,
  '/timetable' => Icons.schedule,
  '/fees' => Icons.account_balance_wallet_outlined,
  '/results' => Icons.bar_chart,
  '/calendar' => Icons.calendar_today_outlined,
  '/date-sheet' => Icons.description_outlined,
  '/notices' => Icons.campaign_outlined,
  '/queries' => Icons.help_outline,
  '/messages' => Icons.chat_bubble_outline,
  '/profile' => Icons.person_outline,
  '/teachers' => Icons.people_outline,
  '/documents' => Icons.folder_outlined,
  '/health' => Icons.favorite_border,
  '/certificates' => Icons.workspace_premium_outlined,
  '/directory' => Icons.contact_phone_outlined,
  '/transport' => Icons.directions_bus_outlined,
  '/hostel' => Icons.bed_outlined,
  '/library' => Icons.local_library_outlined,
  '/appointments' => Icons.event_available_outlined,
  '/gate-passes' => Icons.badge_outlined,
  '/consents' => Icons.fact_check_outlined,
  '/assistant' => Icons.smart_toy_outlined,
  '/help' => Icons.help_center_outlined,
  _ => menuIcon(icon),
};

/// A screen's short name (tabs, shortcut tiles, the Academics list): the word the app always used, else the menu's.
String shortLabel(S s, FamilyEntry e) => switch (e.href) {
  '/fees' => s.fees,
  '/messages' => s.messages,
  '/homework' => s.homework,
  '/timetable' => s.timetable,
  '/results' => s.results,
  '/attendance' => s.attendance,
  '/calendar' => s.calendar,
  '/notices' => s.notices,
  '/date-sheet' => s.dateSheet,
  _ => s.menu(e.label),
};

/// A shortcut's key: `/date-sheet` → `dateSheet` (the tile's `shortcut-<key>`).
String screenKey(String href) {
  final parts = href.replaceAll('/', '').split('-');
  return parts.first +
      parts.skip(1).map((w) => w.isEmpty ? w : w[0].toUpperCase() + w.substring(1)).join();
}

/// Opens a screen of the layout in the app (every family screen has one).
void openFamilyScreen(BuildContext context, S s, Profile p, FamilyEntry e) {
  // the assistant opens over the app as the chat window (docs/design/92)
  if (e.href.split('?').first == '/assistant') {
    openAssistant(context, p);
    return;
  }
  final screen = nativeScreen(p, e.href, s);
  if (screen != null) pushPage(context, shortLabel(s, e), screen);
}

/// "Edit shortcuts": the person's own Home shortcuts — pin any screen they can open, remove, reorder (4 to 12); back
/// to the school's. Kept for them (website and app).
class EditShortcutsScreen extends ConsumerStatefulWidget {
  const EditShortcutsScreen({super.key, required this.profile, required this.layout});
  final Profile profile;
  final FamilyLayoutView layout;

  @override
  ConsumerState<EditShortcutsScreen> createState() => _EditShortcutsScreenState();
}

class _EditShortcutsScreenState extends ConsumerState<EditShortcutsScreen> {
  late final List<FamilyEntry> _chosen = [...widget.layout.shortcuts];
  final _find = TextEditingController();
  String _q = '';
  bool _busy = false;
  String? _error;

  String get _kind => widget.profile.kind == 'student' ? 'student' : 'parent';

  @override
  void dispose() {
    _find.dispose();
    super.dispose();
  }

  void _add(FamilyEntry e) {
    final s = ref.read(stringsProvider);
    setState(() {
      if (_chosen.length >= 12) {
        _error = s.layTwelve;
      } else {
        _chosen.add(e);
        _error = null;
      }
    });
  }

  Future<void> _save() async {
    final s = ref.read(stringsProvider);
    if (_chosen.length < 4) return setState(() => _error = s.layNeedFour);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .familyLayoutSaveMine(
            kind: _kind,
            body: FamilyShortcutsDto(shortcuts: [for (final e in _chosen) e.href]),
          );
      ref.invalidate(familyLayoutProvider(widget.profile));
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = errorText(s, e);
        });
      }
    }
  }

  Future<void> _reset() async {
    final s = ref.read(stringsProvider);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(apiProvider).familyLayoutResetMine(kind: _kind);
      ref.invalidate(familyLayoutProvider(widget.profile));
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = errorText(s, e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final chosen = {for (final e in _chosen) e.href};
    final words = _q.toLowerCase();
    final rest = widget.layout.screens
        .where((e) => !chosen.contains(e.href))
        .where((e) => words.isEmpty || s.menu(e.label).toLowerCase().contains(words))
        .toList();
    return ListView(
      key: const Key('editShortcuts'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        Text(s.layEditHelp, style: TextStyle(color: muted, fontSize: 14)),
        const SizedBox(height: Tokens.sp3),
        SectionTitle(s.layChosen(_chosen.length)),
        Card(
          child: Column(
            children: [
              for (final (i, e) in _chosen.indexed)
                Padding(
                  key: Key('mine-${screenKey(e.href)}'),
                  padding: const EdgeInsets.only(left: Tokens.sp4),
                  child: Row(
                    children: [
                      Icon(screenIcon(e.href, e.icon)),
                      const SizedBox(width: Tokens.sp3),
                      Expanded(child: Text(s.menu(e.label))),
                      IconButton(
                        tooltip: s.layUp(s.menu(e.label)),
                        icon: const Icon(Icons.arrow_upward),
                        onPressed: i == 0
                            ? null
                            : () => setState(() => _chosen.insert(i - 1, _chosen.removeAt(i))),
                      ),
                      IconButton(
                        tooltip: s.layDown(s.menu(e.label)),
                        icon: const Icon(Icons.arrow_downward),
                        onPressed: i == _chosen.length - 1
                            ? null
                            : () => setState(() => _chosen.insert(i + 1, _chosen.removeAt(i))),
                      ),
                      IconButton(
                        key: Key('remove-${screenKey(e.href)}'),
                        tooltip: s.layRemove(s.menu(e.label)),
                        icon: const Icon(Icons.remove_circle_outline),
                        onPressed: () => setState(() {
                          _chosen.removeAt(i);
                          _error = null;
                        }),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
        if (_error != null) ...[const SizedBox(height: Tokens.sp2), ErrorText(_error!)],
        const SizedBox(height: Tokens.sp3),
        FilledButton(
          key: const Key('saveShortcuts'),
          onPressed: _busy ? null : _save,
          child: Text(s.laySave),
        ),
        if (widget.layout.ownShortcuts) ...[
          const SizedBox(height: Tokens.sp2),
          OutlinedButton(
            key: const Key('resetShortcuts'),
            onPressed: _busy ? null : _reset,
            child: Text(s.layReset),
          ),
        ],
        SectionTitle(s.layAdd),
        TextField(
          key: const Key('findScreen'),
          controller: _find,
          decoration: InputDecoration(
            labelText: s.layFind,
            prefixIcon: const Icon(Icons.search),
            border: const OutlineInputBorder(),
          ),
          onChanged: (v) => setState(() => _q = v.trim()),
        ),
        const SizedBox(height: Tokens.sp2),
        Card(
          child: Column(
            children: [
              for (final e in rest)
                ListTile(
                  key: Key('add-${screenKey(e.href)}'),
                  leading: Icon(screenIcon(e.href, e.icon)),
                  title: Text(s.menu(e.label)),
                  trailing: const Icon(Icons.add_circle_outline),
                  onTap: () => _add(e),
                ),
            ],
          ),
        ),
      ],
    );
  }
}
