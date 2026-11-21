import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/home_shell.dart' show nativeScreen;
import 'common.dart';
import 'data.dart';

/// The words of Help (as the website's, in English and Hindi).
extension HelpWords on S {
  String _h(String en, String hi) => hindi ? hi : en;

  String get helpIntro => _h(
    'Answers to the common questions. For anything else, the school office is the first contact.',
    'आम प्रश्नों के उत्तर। किसी और बात के लिए विद्यालय कार्यालय पहला संपर्क है।',
  );
  String get helpSearch => _h('Search the questions', 'प्रश्न खोजें');
  String get helpClear => _h('Clear the search', 'खोज हटाएँ');
  String helpCount(int n) => _h(n == 1 ? '1 question' : '$n questions', '$n प्रश्न');
  String helpFound(int n, String q) =>
      _h('${helpCount(n)} for “$q”', '“$q” के लिए ${helpCount(n)}');
  String get helpNothing => _h(
    'Nothing matches your search. The school office can help with anything else.',
    'आपकी खोज से कुछ नहीं मिला। किसी और बात में विद्यालय कार्यालय मदद कर सकता है।',
  );
  String get helpNone => _h(
    'No questions yet. For anything else, the school office is the first contact.',
    'अभी कोई प्रश्न नहीं। किसी और बात के लिए विद्यालय कार्यालय पहला संपर्क है।',
  );
  String helpOpen(String screen) => _h('Open $screen', '$screen खोलें');
  String get helpHelpful => _h('Was this helpful?', 'क्या यह मददगार था?');
  String get helpYes => _h('Yes', 'हाँ');
  String get helpNo => _h('No', 'नहीं');
  String get helpThanksYes =>
      _h('Thank you. You said this helped.', 'धन्यवाद। आपने बताया कि इससे मदद मिली।');
  String get helpThanksNo => _h(
    'Thank you. You said this did not help; the school office can help further.',
    'धन्यवाद। आपने बताया कि इससे मदद नहीं मिली; विद्यालय कार्यालय आगे मदद कर सकता है।',
  );
}

/// The school's Help for this parent or student (kept on Helpdesk set-up): headings with their questions.
final familyHelpProvider = FutureProvider.autoDispose.family<Loaded<Json>, Profile>((ref, p) async {
  final r = await cached(
    'help:${p.id}',
    () => ref.read(apiProvider).familyHelpMine(for_: p.kind == 'student' ? 'student' : 'parent'),
  );
  return Loaded(asJson(r.data), r.at, stale: r.stale);
});

/// Help as the website shows it: the school's own questions under headings that fold, a search box, the screen an
/// answer is about (opened in the app) and "Was this helpful?" — no web page.
class HelpScreen extends ConsumerStatefulWidget {
  const HelpScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<HelpScreen> createState() => _HelpScreenState();
}

class _HelpScreenState extends ConsumerState<HelpScreen> {
  final _search = TextEditingController();
  String _q = '';

  /// Votes given on this screen (the list keeps the vote the API had when it loaded).
  final _votes = <String, bool>{};
  final _busy = <String>{};

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _vote(String id, bool helpful) async {
    final s = ref.read(stringsProvider);
    setState(() => _busy.add(id));
    try {
      await ref
          .read(apiProvider)
          .familyHelpVote(
            id: id,
            body: FamilyHelpVoteDto(helpful: helpful),
          );
      if (!mounted) return;
      setState(() {
        _busy.remove(id);
        _votes[id] = helpful;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _busy.remove(id));
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
    }
  }

  void _open(String page, String label) {
    final s = ref.read(stringsProvider);
    final screen = nativeScreen(widget.profile, page, s);
    if (screen != null) pushPage(context, s.menu(label), screen);
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    String pick(Json x, String key) => s.hindi ? '${x['${key}Hi'] ?? x[key]}' : '${x[key]}';
    final words = _q.toLowerCase();
    bool matches(Json x) =>
        words.isEmpty ||
        [
          x['question'],
          x['questionHi'],
          x['answer'],
          x['answerHi'],
        ].any((v) => v is String && v.toLowerCase().contains(words));
    return LoadedList<Json>(
      value: ref.watch(familyHelpProvider(widget.profile)),
      refresh: () => ref.refresh(familyHelpProvider(widget.profile).future),
      children: (d) {
        final groups = asList(d['groups']);
        final shown = [for (final g in groups) (g, asList(g['questions']).where(matches).toList())]
            .where((x) => x.$2.isNotEmpty)
            .toList();
        final found = shown.fold<int>(0, (n, x) => n + x.$2.length);
        return [
          Text(
            s.helpIntro,
            key: const Key('helpIntro'),
            style: TextStyle(color: muted, fontSize: 14),
          ),
          const SizedBox(height: Tokens.sp3),
          if (groups.isEmpty)
            EmptyLine(s.helpNone)
          else ...[
            TextField(
              key: const Key('helpSearch'),
              controller: _search,
              textInputAction: TextInputAction.search,
              maxLength: 100,
              decoration: InputDecoration(
                labelText: s.helpSearch,
                prefixIcon: const Icon(Icons.search),
                counterText: '',
                border: const OutlineInputBorder(),
                suffixIcon: _q.isEmpty
                    ? null
                    : IconButton(
                        key: const Key('helpClear'),
                        tooltip: s.helpClear,
                        icon: const Icon(Icons.close),
                        onPressed: () => setState(() {
                          _search.clear();
                          _q = '';
                        }),
                      ),
              ),
              onChanged: (v) => setState(() => _q = v.trim()),
            ),
            const SizedBox(height: Tokens.sp2),
            if (_q.isNotEmpty)
              Semantics(
                liveRegion: true,
                child: Text(
                  found > 0 ? s.helpFound(found, _q) : s.helpNothing,
                  key: const Key('helpFound'),
                  style: TextStyle(color: muted, fontSize: 13),
                ),
              ),
            const SizedBox(height: Tokens.sp2),
            for (final (g, questions) in shown)
              Card(
                clipBehavior: Clip.antiAlias,
                child: ExpansionTile(
                  // a search opens every heading it found something under
                  key: Key('helpGroup-${g['id'] ?? 'other'}-${_q.isNotEmpty}'),
                  initiallyExpanded: _q.isNotEmpty,
                  leading: const Icon(Icons.help_outline),
                  title: Text(
                    pick(g, 'title'),
                    style: const TextStyle(fontWeight: Tokens.fwSemibold),
                  ),
                  subtitle: Text(
                    s.helpCount(questions.length),
                    style: TextStyle(color: muted, fontSize: 13),
                  ),
                  shape: const Border(),
                  collapsedShape: const Border(),
                  expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [for (final x in questions) _question(context, s, x, pick, muted)],
                ),
              ),
          ],
        ];
      },
    );
  }

  Widget _question(
    BuildContext context,
    S s,
    Json x,
    String Function(Json, String) pick,
    Color muted,
  ) {
    final id = '${x['id']}';
    final vote = _votes[id] ?? x['myVote'] as bool?;
    final page = x['page'] as String?;
    final label = x['pageLabel'] as String?;
    final busy = _busy.contains(id);
    return ExpansionTile(
      key: Key('help-$id'),
      title: Text(pick(x, 'question'), style: const TextStyle(fontWeight: Tokens.fwSemibold)),
      shape: const Border(),
      collapsedShape: const Border(),
      expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
      childrenPadding: const EdgeInsets.fromLTRB(Tokens.sp4, 0, Tokens.sp4, Tokens.sp3),
      children: [
        Text(pick(x, 'answer')),
        const SizedBox(height: Tokens.sp2),
        if (page != null && label != null) ...[
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              key: Key('helpOpen-$id'),
              icon: const Icon(Icons.open_in_new, size: 18),
              label: Text(s.helpOpen(s.menu(label))),
              onPressed: () => _open(page, label),
            ),
          ),
          const SizedBox(height: Tokens.sp2),
        ],
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp1,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Text(s.helpHelpful, style: TextStyle(color: muted, fontSize: 13)),
            ChoiceChip(
              key: Key('helpYes-$id'),
              label: Text(s.helpYes),
              selected: vote == true,
              onSelected: busy ? null : (_) => _vote(id, true),
            ),
            ChoiceChip(
              key: Key('helpNo-$id'),
              label: Text(s.helpNo),
              selected: vote == false,
              onSelected: busy ? null : (_) => _vote(id, false),
            ),
          ],
        ),
        if (vote != null)
          Semantics(
            liveRegion: true,
            child: Text(
              vote ? s.helpThanksYes : s.helpThanksNo,
              key: Key('helpThanks-$id'),
              style: TextStyle(color: muted, fontSize: 13),
            ),
          ),
      ],
    );
  }
}
