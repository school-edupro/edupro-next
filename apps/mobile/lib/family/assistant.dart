import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart' show ApiException;
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'common.dart';
import 'data.dart';
import 'profile.dart' show ProfileScreen;

/// The words of the family assistant (as the website's, in English and Hindi).
extension AssistantWords on S {
  String _as(String en, String hi) => hindi ? hi : en;

  String get asstTitle => _as('Ask about your children', 'अपने बच्चों के बारे में पूछें');
  String get asstIntro => _as(
    'Fees due, attendance, homework and notices of your own children, in English, Hindi or Hinglish. Answers come only from school records and name their source.',
    'अपने बच्चों का बकाया शुल्क, उपस्थिति, गृहकार्य और सूचनाएँ, अंग्रेज़ी, हिन्दी या हिंग्लिश में। उत्तर केवल विद्यालय के अभिलेखों से आते हैं और अपना स्रोत बताते हैं।',
  );
  String get asstBlocked => _as(
    'The assistant is not enabled for families in this school yet.',
    'इस विद्यालय में अभिभावकों के लिए सहायक अभी चालू नहीं है।',
  );
  String get asstConsent => _as(
    'The assistant needs your consent (AI assistant) first. Turn it on under Profile → Your consents; you can withdraw it at any time.',
    'सहायक के लिए पहले आपकी सहमति (AI सहायक) चाहिए। प्रोफ़ाइल → आपकी सहमतियाँ में इसे चालू करें; आप इसे कभी भी वापस ले सकते हैं।',
  );
  String get asstOpenProfile => _as('Open profile', 'प्रोफ़ाइल खोलें');
  String get asstYou => _as('You', 'आप');
  String get asstName => _as('Assistant', 'सहायक');
  String get asstQuestion => _as('Your question', 'आपका प्रश्न');
  String get asstLanguage => _as('Language', 'भाषा');
  String get asstAuto => _as('Auto', 'स्वतः');
  String get asstAsk => _as('Ask', 'पूछें');
  String get asstNew => _as('New conversation', 'नई बातचीत');
  String get asstCanAsk => _as('What you can ask', 'आप क्या पूछ सकते हैं');
  String asstCanAskHint(int n) =>
      _as(n == 1 ? '1 kind of question' : '$n kinds of question', '$n तरह के प्रश्न');
  String get asstStored => _as(
    'Your questions are stored with personal details masked and can be withdrawn with the consent.',
    'आपके प्रश्न व्यक्तिगत विवरण छिपाकर संग्रहीत होते हैं और सहमति वापस लेने पर हटाए जा सकते हैं।',
  );
  String get asstRecent => _as('Recent conversations', 'हाल की बातचीत');
  String asstRecentHint(int n) => _as('$n · latest first', '$n · नवीनतम पहले');
  String get asstNeedQuestion =>
      _as('Write a question (at least 2 letters).', 'प्रश्न लिखें (कम से कम 2 अक्षर)।');
  String get asstThinking => _as('Finding the answer…', 'उत्तर खोजा जा रहा है…');
  String asstSource(String t) => _as('Source: $t', 'स्रोत: $t');
}

/// What may be asked and the person's conversations; null: the assistant is not open to this person (403).
final assistantHomeProvider = FutureProvider.autoDispose
    .family<Loaded<(List<Json>, List<Json>)?>, Profile>((ref, p) async {
      final api = ref.read(apiProvider);
      try {
        final r = await Future.wait([api.insightsCatalogue(), api.insightsConversations()]);
        return Loaded((asList(asJson(r[0])['data']), asList(asJson(r[1])['data'])), DateTime.now());
      } on ApiException catch (e) {
        if (e.status == 403) return Loaded(null, DateTime.now());
        rethrow;
      }
    });

/// One conversation with its messages (null when it cannot be read, as on the website).
final assistantConversationProvider = FutureProvider.autoDispose.family<Json?, String>((
  ref,
  id,
) async {
  try {
    return asJson(await ref.read(apiProvider).insightsConversation(id: id));
  } catch (_) {
    return null;
  }
});

/// The family assistant as the website has it (apps/parent/app/(app)/assistant): the conversation, a question in
/// English, Hindi or Hinglish, what may be asked and the recent conversations — no web page.
class AssistantScreen extends ConsumerStatefulWidget {
  const AssistantScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<AssistantScreen> createState() => _AssistantScreenState();
}

class _AssistantScreenState extends ConsumerState<AssistantScreen> {
  final _question = TextEditingController();
  String? _current;
  String _language = '';
  bool _busy = false;
  bool _consent = false;
  String? _error;

  @override
  void dispose() {
    _question.dispose();
    super.dispose();
  }

  Future<void> _ask() async {
    final s = ref.read(stringsProvider);
    final q = _question.text.trim();
    if (q.length < 2) return setState(() => _error = s.asstNeedQuestion);
    setState(() {
      _busy = true;
      _error = null;
      _consent = false;
    });
    try {
      final r = asJson(
        await ref
            .read(apiProvider)
            .insightsAsk(
              body: AskAssistantDto(
                question: q,
                conversationId: _current,
                language: _language.isEmpty ? null : _language,
                surface: 'parent',
              ),
            ),
      );
      if (!mounted) return;
      _question.clear();
      final id = '${r['conversationId']}';
      ref.invalidate(assistantConversationProvider(id));
      ref.invalidate(assistantHomeProvider);
      setState(() {
        _busy = false;
        _current = id;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        if (e is ApiException && e.type == 'consent-required') {
          _consent = true;
        } else {
          _error = errorText(s, e);
        }
      });
    }
  }

  void _open(String? id) => setState(() {
    _current = id;
    _error = null;
    _consent = false;
  });

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    return LoadedList<(List<Json>, List<Json>)?>(
      value: ref.watch(assistantHomeProvider(widget.profile)),
      refresh: () => ref.refresh(assistantHomeProvider(widget.profile).future),
      children: (home) {
        final head = [
          Text(
            s.asstTitle,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
          ),
          Text(s.asstIntro, style: TextStyle(color: muted, fontSize: 14)),
          const SizedBox(height: Tokens.sp3),
        ];
        if (home == null) {
          return [
            ...head,
            Card(
              key: const Key('asstBlocked'),
              child: Padding(padding: const EdgeInsets.all(Tokens.sp4), child: Text(s.asstBlocked)),
            ),
          ];
        }
        final (catalogue, conversations) = home;
        final allowed = catalogue.where((e) => e['allowed'] == true).toList();
        return [
          ...head,
          if (_consent) ...[
            Container(
              key: const Key('asstConsent'),
              padding: const EdgeInsets.all(Tokens.sp3),
              decoration: BoxDecoration(
                color: (dark ? Tokens.mobGray900 : Tokens.statusWarningBg),
                borderRadius: BorderRadius.circular(Tokens.radiusSm),
                border: Border.all(color: Tokens.statusWarning),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Semantics(liveRegion: true, child: Text(s.asstConsent)),
                  const SizedBox(height: Tokens.sp2),
                  OutlinedButton(
                    key: const Key('asstOpenProfile'),
                    onPressed: () =>
                        pushPage(context, s.profileTitle, ProfileScreen(profile: widget.profile)),
                    child: Text(s.asstOpenProfile),
                  ),
                ],
              ),
            ),
            const SizedBox(height: Tokens.sp3),
          ],
          Card(
            child: Padding(
              padding: const EdgeInsets.all(Tokens.sp4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (_current != null) _Thread(id: _current!),
                  TextField(
                    key: const Key('asstQuestion'),
                    controller: _question,
                    minLines: 3,
                    maxLines: 6,
                    maxLength: 1000,
                    textInputAction: TextInputAction.newline,
                    decoration: InputDecoration(
                      labelText: s.asstQuestion,
                      hintText: 'Kitni fees baki hai? · Was my child absent this week? · इस हफ्ते का गृहकार्य',
                      hintMaxLines: 3,
                      alignLabelWithHint: true,
                      border: const OutlineInputBorder(),
                    ),
                  ),
                  Text(s.asstLanguage, style: TextStyle(color: muted, fontSize: 13)),
                  const SizedBox(height: Tokens.sp1),
                  Wrap(
                    spacing: Tokens.sp2,
                    runSpacing: Tokens.sp2,
                    children: [
                      for (final (v, label) in [
                        ('', s.asstAuto),
                        ('en', 'English'),
                        ('hi', 'हिन्दी'),
                        ('hinglish', 'Hinglish'),
                      ])
                        ChoiceChip(
                          key: Key('asstLang-${v.isEmpty ? 'auto' : v}'),
                          label: Text(label),
                          selected: _language == v,
                          showCheckmark: false,
                          onSelected: (_) => setState(() => _language = v),
                        ),
                    ],
                  ),
                  if (_error != null) ...[const SizedBox(height: Tokens.sp3), ErrorText(_error!)],
                  const SizedBox(height: Tokens.sp3),
                  if (_busy) ...[
                    Semantics(
                      liveRegion: true,
                      child: Text(s.asstThinking, style: TextStyle(color: muted)),
                    ),
                    const SizedBox(height: Tokens.sp2),
                    const LinearProgressIndicator(),
                    const SizedBox(height: Tokens.sp3),
                  ],
                  Wrap(
                    spacing: Tokens.sp2,
                    runSpacing: Tokens.sp2,
                    children: [
                      FilledButton.icon(
                        key: const Key('asstAsk'),
                        icon: const Icon(Icons.send_outlined),
                        label: Text(s.asstAsk),
                        onPressed: _busy ? null : _ask,
                      ),
                      if (_current != null)
                        OutlinedButton(
                          key: const Key('asstNew'),
                          onPressed: _busy ? null : () => _open(null),
                          child: Text(s.asstNew),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: Tokens.sp3),
          _fold(
            context,
            id: 'asstCanAsk',
            icon: Icons.lightbulb_outline,
            title: s.asstCanAsk,
            hint: s.asstCanAskHint(allowed.length),
            children: [
              for (final e in allowed)
                ListTile(
                  dense: true,
                  title: Text(
                    s.hindi ? '${e['titleHi'] ?? e['title']}' : '${e['title']}',
                    style: const TextStyle(fontWeight: Tokens.fwSemibold),
                  ),
                  subtitle: s.hindi || e['description'] == null
                      ? null
                      : Text('${e['description']}', style: TextStyle(color: muted)),
                ),
              Padding(
                padding: const EdgeInsets.fromLTRB(Tokens.sp4, Tokens.sp2, Tokens.sp4, Tokens.sp4),
                child: Text(s.asstStored, style: TextStyle(color: muted, fontSize: 13)),
              ),
            ],
          ),
          if (conversations.isNotEmpty) ...[
            const SizedBox(height: Tokens.sp3),
            _fold(
              context,
              id: 'asstRecent',
              title: s.asstRecent,
              hint: s.asstRecentHint(conversations.length.clamp(0, 10)),
              children: [
                for (final c in conversations.take(10))
                  ListTile(
                    key: Key('asstConv-${c['id']}'),
                    selected: c['id'] == _current,
                    leading: const Icon(Icons.chat_bubble_outline),
                    title: Text(
                      '${c['title'] ?? '${c['id']}'.substring(0, 8)}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(
                      s.dayShort(DateTime.tryParse('${c['updatedAt']}')?.toLocal() ?? ''),
                      style: TextStyle(color: muted, fontSize: 13),
                    ),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => _open('${c['id']}'),
                  ),
              ],
            ),
          ],
        ];
      },
    );
  }
}

/// The messages of the conversation in use: the person's questions and the assistant's answers with their sources.
class _Thread extends ConsumerWidget {
  const _Thread({required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final conv = ref.watch(assistantConversationProvider(id));
    if (conv.isLoading && !conv.hasValue) {
      return const Padding(
        padding: EdgeInsets.only(bottom: Tokens.sp3),
        child: LinearProgressIndicator(),
      );
    }
    final messages = asList(conv.value?['messages']);
    if (messages.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: Tokens.sp3),
      child: Column(
        key: const Key('asstThread'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final m in messages)
            Container(
              margin: const EdgeInsets.only(bottom: Tokens.sp3),
              padding: const EdgeInsets.only(left: Tokens.sp3),
              decoration: BoxDecoration(
                border: Border(
                  left: BorderSide(
                    width: 3,
                    color: m['role'] == 'user'
                        ? (dark ? Tokens.mobGray700 : Tokens.mobGray100)
                        : Tokens.mobCyan500,
                  ),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    m['role'] == 'user' ? s.asstYou : s.asstName,
                    style: TextStyle(color: muted, fontSize: 12, fontWeight: Tokens.fwBold),
                  ),
                  Text('${m['content'] ?? ''}'),
                  if (asList(m['citations']).isNotEmpty) ...[
                    const SizedBox(height: Tokens.sp1),
                    Wrap(
                      spacing: Tokens.sp2,
                      runSpacing: Tokens.sp1,
                      children: [
                        for (final c in asList(m['citations']))
                          Semantics(
                            label: s.asstSource('${c['title']}'),
                            excludeSemantics: true,
                            child: StatusChip('${c['title']}', Tone.neutral),
                          ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// A part of the page folded in a card until tapped, with a line saying what is inside.
Widget _fold(
  BuildContext context, {
  required String id,
  required String title,
  required String hint,
  required List<Widget> children,
  IconData icon = Icons.history_outlined,
}) {
  final dark = Theme.of(context).brightness == Brightness.dark;
  return Card(
    clipBehavior: Clip.antiAlias,
    child: ExpansionTile(
      key: Key(id),
      leading: Icon(icon),
      title: Text(title, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
      subtitle: Text(
        hint,
        style: TextStyle(color: (dark ? Tokens.mobGray300 : Tokens.textMuted), fontSize: 13),
      ),
      shape: const Border(),
      collapsedShape: const Border(),
      expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
      children: children,
    ),
  );
}
