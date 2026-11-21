import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart' show ApiException;
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/home_shell.dart' show nativeScreen;
import '../ui/widgets.dart';
import 'common.dart';
import 'data.dart';
import 'profile.dart' show ProfileScreen;

/// The words of the assistant (as the websites', in English and Hindi), for students, parents, teachers and the office.
extension AssistantWords on S {
  String _as(String en, String hi) => hindi ? hi : en;

  String asstTitleOf(String audience) => switch (audience) {
    'student' => _as('Ask about your school day', 'अपने विद्यालय के बारे में पूछें'),
    'teacher' => _as('Ask about your classes', 'अपनी कक्षाओं के बारे में पूछें'),
    'admin' => _as('Ask about the school', 'विद्यालय के बारे में पूछें'),
    _ => _as('Ask about your children', 'अपने बच्चों के बारे में पूछें'),
  };
  String asstIntroOf(String audience) => switch (audience) {
    'student' => _as(
      'Your attendance, timetable, homework, exams, results and library books, in English, Hindi or Hinglish. Answers come only from school records and name their source.',
      'आपकी उपस्थिति, समय-सारिणी, गृहकार्य, परीक्षाएँ, परिणाम और पुस्तकालय की पुस्तकें, अंग्रेज़ी, हिन्दी या हिंग्लिश में। उत्तर केवल विद्यालय के अभिलेखों से आते हैं और अपना स्रोत बताते हैं।',
    ),
    'teacher' => _as(
      'Your sections’ attendance, homework and marks, and your own attendance, leave and timetable. Answers come only from school records and name their source.',
      'आपके अनुभागों की उपस्थिति, गृहकार्य और अंक, और आपकी अपनी उपस्थिति, अवकाश और समय-सारिणी। उत्तर केवल विद्यालय के अभिलेखों से आते हैं और अपना स्रोत बताते हैं।',
    ),
    'admin' => _as(
      'Today’s figures, attendance, fees, admissions and staff, as far as your rights go. Answers come only from school records and name their source.',
      'आज के आँकड़े, उपस्थिति, शुल्क, प्रवेश और कर्मचारी, आपके अधिकारों के अनुसार। उत्तर केवल विद्यालय के अभिलेखों से आते हैं और अपना स्रोत बताते हैं।',
    ),
    _ => _as(
      'Fees due, attendance, homework and notices of your own children, in English, Hindi or Hinglish. Answers come only from school records and name their source.',
      'अपने बच्चों का बकाया शुल्क, उपस्थिति, गृहकार्य और सूचनाएँ, अंग्रेज़ी, हिन्दी या हिंग्लिश में। उत्तर केवल विद्यालय के अभिलेखों से आते हैं और अपना स्रोत बताते हैं।',
    ),
  };
  String asstHintOf(String audience) => switch (audience) {
    'student' => 'Aaj ki classes? · My homework this week · मेरा परिणाम',
    'teacher' => 'Who is absent today? · Marks entry status · मेरा अवकाश शेष',
    'admin' => 'Today at a glance · Fee defaulters · आज की उपस्थिति',
    _ => 'Kitni fees baki hai? · Was my child absent this week? · इस हफ्ते का गृहकार्य',
  };
  String get asstBlocked => _as(
    'The assistant is not open to you at this school.',
    'इस विद्यालय में सहायक आपके लिए खुला नहीं है।',
  );
  String get asstOff => _as(
    'Your school has switched the assistant off for you for now.',
    'आपके विद्यालय ने अभी आपके लिए सहायक बंद रखा है।',
  );
  String get asstConsent => _as(
    'The assistant needs your consent (AI assistant) first. Turn it on under Profile → Your consents; you can withdraw it at any time.',
    'सहायक के लिए पहले आपकी सहमति (AI सहायक) चाहिए। प्रोफ़ाइल → आपकी सहमतियाँ में इसे चालू करें; आप इसे कभी भी वापस ले सकते हैं।',
  );
  String get asstAskParent => _as(
    'The assistant needs a parent’s consent first. Ask a parent to turn on “AI assistant” under Profile → Your consents in their app.',
    'सहायक के लिए पहले माता-पिता की सहमति चाहिए। माता-पिता से कहें कि वे अपने ऐप में प्रोफ़ाइल → आपकी सहमतियाँ में “AI सहायक” चालू करें।',
  );
  String asstLimit(int n) => _as(
    'You have asked $n questions today, the most your school allows. Try again tomorrow.',
    'आपने आज $n प्रश्न पूछे हैं, जितने आपका विद्यालय अनुमति देता है। कल फिर पूछें।',
  );
  String asstToday(int asked, int limit) =>
      _as('$asked of $limit questions asked today', 'आज $limit में से $asked प्रश्न पूछे');
  String get asstOpenProfile => _as('Open profile', 'प्रोफ़ाइल खोलें');
  String get asstYou => _as('You', 'आप');
  String get asstName => _as('Assistant', 'सहायक');
  String get asstQuestion => _as('Your question', 'आपका प्रश्न');
  String get asstMic => _as(
    'To speak your question, tap the mic on your keyboard.',
    'प्रश्न बोलने के लिए कीबोर्ड का माइक दबाएँ।',
  );
  String get asstLanguage => _as('Language', 'भाषा');
  String get asstAuto => _as('Auto', 'स्वतः');
  String get asstAsk => _as('Ask', 'पूछें');
  String get asstNew => _as('New conversation', 'नई बातचीत');
  String get asstTry => _as('Try asking', 'ऐसे पूछें');
  String get asstAgain => _as('Ask again', 'फिर पूछें');
  String get asstNext => _as('Ask next', 'आगे पूछें');
  String get asstDidYouMean => _as('Did you mean', 'क्या आपका मतलब है');
  String get asstInstead => _as('You can ask', 'आप पूछ सकते हैं');
  String asstOpen(String screen) => _as('Open $screen', '$screen खोलें');
  String asstMore(int n) => _as('and $n more', 'और $n');
  String get asstCanAsk => _as('What you can ask', 'आप क्या पूछ सकते हैं');
  String asstCanAskHint(int n) =>
      _as(n == 1 ? '1 kind of question' : '$n kinds of question', '$n तरह के प्रश्न');
  String get asstStored => _as(
    'Your questions are stored with personal details masked. Nothing is sent outside the school’s system.',
    'आपके प्रश्न व्यक्तिगत विवरण छिपाकर संग्रहीत होते हैं। विद्यालय की प्रणाली से बाहर कुछ नहीं भेजा जाता।',
  );
  String get asstRecent => _as('Recent conversations', 'हाल की बातचीत');
  String asstRecentHint(int n) => _as('$n · latest first', '$n · नवीनतम पहले');
  String get asstNeedQuestion =>
      _as('Write a question (at least 2 letters).', 'प्रश्न लिखें (कम से कम 2 अक्षर)।');
  String get asstThinking => _as('Finding the answer…', 'उत्तर खोजा जा रहा है…');
  String asstSource(String t) => _as('Source: $t', 'स्रोत: $t');
}

/// The assistant's start for the person: on for them, the consent, starter and recent questions, today's count
/// (docs/design/91 §C), what may be asked and the conversations. Null: the assistant is not open to them (403).
class AssistantHome {
  const AssistantHome({required this.start, required this.catalogue, required this.conversations});
  final Json start;
  final List<Json> catalogue;
  final List<Json> conversations;

  String get audience => '${start['audience'] ?? 'parent'}';
  bool get on => start['on'] != false;

  /// granted · needed (the parent's own) · ask_parent (a student's parent has not consented) · null (staff)
  String? get consent => start['consent'] as String?;
  int get askedToday => (start['askedToday'] as num?)?.toInt() ?? 0;
  int get dailyLimit => (start['dailyLimit'] as num?)?.toInt() ?? 0;
  bool get atLimit => dailyLimit > 0 && askedToday >= dailyLimit;
}

final assistantHomeProvider = FutureProvider.autoDispose.family<Loaded<AssistantHome?>, Profile>((
  ref,
  p,
) async {
  final api = ref.read(apiProvider);
  try {
    final r = await Future.wait([
      api.insightsStart(),
      api.insightsCatalogue(),
      api.insightsConversations(),
    ]);
    return Loaded(
      AssistantHome(
        start: asJson(r[0]),
        catalogue: asList(asJson(r[1])['data']),
        conversations: asList(asJson(r[2])['data']),
      ),
      DateTime.now(),
    );
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

/// The assistant in the app for every profile (docs/design/91 phase D): the start (starters, ask again, today's
/// count), the conversation with each answer's card, the screen to open and the questions to ask next — no web page.
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

  /// the API said so when asking (the start may be older than a consent withdrawn or a limit reached meanwhile)
  String? _consent;
  int? _limit;
  String? _error;

  @override
  void dispose() {
    _question.dispose();
    super.dispose();
  }

  Future<void> _ask([String? text]) async {
    final s = ref.read(stringsProvider);
    final q = (text ?? _question.text).trim();
    if (q.length < 2) return setState(() => _error = s.asstNeedQuestion);
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _busy = true;
      _error = null;
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
                // the staff app is the teachers' website; families ask as the parents' website
                surface: widget.profile.isStaff ? 'teacher' : 'parent',
              ),
            ),
      );
      if (!mounted) return;
      if (text == null) _question.clear();
      final id = '${r['conversationId']}';
      ref.invalidate(assistantConversationProvider(id));
      ref.invalidate(assistantHomeProvider(widget.profile));
      setState(() {
        _busy = false;
        _current = id;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        if (e is ApiException && e.type == 'consent-required') {
          _consent = widget.profile.kind == 'student' ? 'ask_parent' : 'needed';
        } else if (e is ApiException && e.type == 'ai.daily_limit') {
          // "You have asked 30 questions today …": the count the school allows
          _limit = int.tryParse(RegExp(r'\d+').firstMatch(e.detail)?.group(0) ?? '') ?? 0;
        } else if (e is ApiException && e.type == 'assistant-off') {
          ref.invalidate(assistantHomeProvider(widget.profile));
        } else {
          _error = errorText(s, e);
        }
      });
    }
  }

  void _open(String? id) => setState(() {
    _current = id;
    _error = null;
  });

  Future<void> _openProfile() async {
    final s = ref.read(stringsProvider);
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => FamilyPage(
          title: s.profileTitle,
          child: ProfileScreen(profile: widget.profile),
        ),
      ),
    );
    // back from the consents: the start says whether it is on now
    if (!mounted) return;
    setState(() => _consent = null);
    ref.invalidate(assistantHomeProvider(widget.profile));
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    return LoadedList<AssistantHome?>(
      value: ref.watch(assistantHomeProvider(widget.profile)),
      refresh: () => ref.refresh(assistantHomeProvider(widget.profile).future),
      children: (home) {
        final audience =
            home?.audience ??
            (widget.profile.isStaff
                ? 'teacher'
                : (widget.profile.kind == 'student' ? 'student' : 'parent'));
        final head = [
          Semantics(
            header: true,
            child: Text(
              s.asstTitleOf(audience),
              style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
            ),
          ),
          Text(s.asstIntroOf(audience), style: TextStyle(color: muted, fontSize: 14)),
          const SizedBox(height: Tokens.sp3),
        ];
        if (home == null) {
          return [...head, _Banner(id: 'asstBlocked', text: s.asstBlocked)];
        }
        final consent = _consent ?? home.consent;
        final waiting = consent == 'needed' || consent == 'ask_parent';
        final limit = _limit != null ? (_limit! > 0 ? _limit! : home.dailyLimit) : null;
        final atLimit = limit != null || home.atLimit;
        final canAsk = home.on && !waiting && !atLimit;
        final allowed = home.catalogue.where((e) => e['allowed'] == true).toList();
        final starters = asList(home.start['starters']);
        final recent = asList(home.start['recent']);
        return [
          ...head,
          if (!home.on) ...[
            _Banner(id: 'asstOff', text: s.asstOff),
            const SizedBox(height: Tokens.sp3),
          ],
          if (home.on && consent == 'needed') ...[
            _Banner(
              id: 'asstConsent',
              text: s.asstConsent,
              action: OutlinedButton(
                key: const Key('asstOpenProfile'),
                onPressed: _openProfile,
                child: Text(s.asstOpenProfile),
              ),
            ),
            const SizedBox(height: Tokens.sp3),
          ],
          if (home.on && consent == 'ask_parent') ...[
            _Banner(id: 'asstAskParent', text: s.asstAskParent),
            const SizedBox(height: Tokens.sp3),
          ],
          if (home.on && !waiting && atLimit) ...[
            _Banner(id: 'asstLimit', text: s.asstLimit(limit ?? home.askedToday)),
            const SizedBox(height: Tokens.sp3),
          ],
          Card(
            child: Padding(
              padding: const EdgeInsets.all(Tokens.sp4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (_current != null)
                    _Thread(
                      id: _current!,
                      profile: widget.profile,
                      onAsk: canAsk && !_busy ? _ask : null,
                    )
                  else if (canAsk) ...[
                    if (starters.isNotEmpty)
                      _Chips(
                        id: 'asstStarters',
                        title: s.asstTry,
                        questions: [
                          for (final x in starters)
                            s.hindi ? '${x['questionHi'] ?? x['question']}' : '${x['question']}',
                        ],
                        onAsk: _busy ? null : _ask,
                      ),
                    if (recent.isNotEmpty)
                      _Chips(
                        id: 'asstAgain',
                        title: s.asstAgain,
                        icon: Icons.history,
                        questions: [for (final x in recent) '${x['question']}'],
                        onAsk: _busy ? null : _ask,
                      ),
                  ],
                  if (canAsk) ...[
                    TextField(
                      key: const Key('asstQuestion'),
                      controller: _question,
                      minLines: 2,
                      maxLines: 6,
                      maxLength: 1000,
                      textInputAction: TextInputAction.newline,
                      decoration: InputDecoration(
                        labelText: s.asstQuestion,
                        hintText: s.asstHintOf(audience),
                        hintMaxLines: 3,
                        helperText: s.asstMic,
                        helperMaxLines: 2,
                        alignLabelWithHint: true,
                        border: const OutlineInputBorder(),
                      ),
                    ),
                    const SizedBox(height: Tokens.sp2),
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
                  ],
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
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      if (canAsk)
                        FilledButton.icon(
                          key: const Key('asstAsk'),
                          icon: const Icon(Icons.send_outlined),
                          label: Text(s.asstAsk),
                          onPressed: _busy ? null : () => _ask(),
                        ),
                      if (_current != null)
                        OutlinedButton(
                          key: const Key('asstNew'),
                          onPressed: _busy ? null : () => _open(null),
                          child: Text(s.asstNew),
                        ),
                    ],
                  ),
                  if (home.on && home.dailyLimit > 0) ...[
                    const SizedBox(height: Tokens.sp2),
                    Text(
                      s.asstToday(home.askedToday, home.dailyLimit),
                      key: const Key('asstCount'),
                      style: TextStyle(color: muted, fontSize: 13),
                    ),
                  ],
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
          if (home.conversations.isNotEmpty) ...[
            const SizedBox(height: Tokens.sp3),
            _fold(
              context,
              id: 'asstRecent',
              title: s.asstRecent,
              hint: s.asstRecentHint(home.conversations.length.clamp(0, 10)),
              children: [
                for (final c in home.conversations.take(10))
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

/// A note in a bordered box (switched off, consent, today's limit), read out when it appears.
class _Banner extends StatelessWidget {
  const _Banner({required this.id, required this.text, this.action});
  final String id;
  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      key: Key(id),
      padding: const EdgeInsets.all(Tokens.sp3),
      decoration: BoxDecoration(
        color: (dark ? Tokens.mobGray900 : Tokens.statusWarningBg),
        borderRadius: BorderRadius.circular(Tokens.radiusSm),
        border: Border.all(color: Tokens.statusWarning),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(liveRegion: true, child: Text(text)),
          if (action != null) ...[const SizedBox(height: Tokens.sp2), action!],
        ],
      ),
    );
  }
}

/// Questions to tap (starters, ask again, ask next, did you mean): a tap asks it.
class _Chips extends StatelessWidget {
  const _Chips({
    required this.id,
    required this.title,
    required this.questions,
    required this.onAsk,
    this.icon = Icons.chat_outlined,
  });
  final String id;
  final String title;
  final List<String> questions;
  final void Function(String)? onAsk;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final shown = questions.where((q) => q.trim().isNotEmpty).toSet().toList();
    if (shown.isEmpty) return const SizedBox.shrink();
    return Padding(
      key: Key(id),
      padding: const EdgeInsets.only(bottom: Tokens.sp3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(
              color: dark ? Tokens.mobGray300 : Tokens.textMuted,
              fontSize: 13,
              fontWeight: Tokens.fwSemibold,
            ),
          ),
          const SizedBox(height: Tokens.sp1),
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp2,
            children: [
              for (final (i, q) in shown.indexed)
                ActionChip(
                  key: Key('$id-$i'),
                  avatar: Icon(icon, size: 18),
                  label: Text(q),
                  onPressed: onAsk == null ? null : () => onAsk!(q),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// The messages of the conversation in use: the person's questions and the assistant's answers with the records
/// (figures or a short table), the screen to open, the sources and — on the last answer — what to ask next.
class _Thread extends ConsumerWidget {
  const _Thread({required this.id, required this.profile, required this.onAsk});
  final String id;
  final Profile profile;
  final void Function(String)? onAsk;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final conv = ref.watch(assistantConversationProvider(id));
    // the screens of the person's menu: an answer opens only those (a screen the school hides is not offered)
    final menu = ref.watch(menuProvider(profile.id));
    if (conv.isLoading && !conv.hasValue) {
      return const Padding(
        padding: EdgeInsets.only(bottom: Tokens.sp3),
        child: LinearProgressIndicator(),
      );
    }
    final messages = asList(conv.value?['messages']);
    if (messages.isEmpty) return const SizedBox.shrink();
    final last = messages.lastIndexWhere((m) => m['role'] == 'assistant');
    return Padding(
      padding: const EdgeInsets.only(bottom: Tokens.sp3),
      child: Column(
        key: const Key('asstThread'),
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final (i, m) in messages.indexed)
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
                  if (m['role'] == 'assistant')
                    ..._said(context, s, asJson(m['display']), menu, latest: i == last),
                  if (asList(m['citations']).isNotEmpty) ...[
                    const SizedBox(height: Tokens.sp2),
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

  /// What was shown with an answer: the card, the screen to open; on the latest, the questions to ask next.
  List<Widget> _said(
    BuildContext context,
    S s,
    Json d,
    AsyncValue<ProfileMenu> menu, {
    required bool latest,
  }) {
    final card = asJson(d['card']);
    final link = asJson(d['link']);
    final open = link.isEmpty ? null : _opener(context, s, link, menu);
    String q(Json x) => '${x['question'] ?? x['title'] ?? ''}';
    return [
      if (card['kind'] == 'figures' && asList(card['figures']).isNotEmpty) ...[
        const SizedBox(height: Tokens.sp2),
        FigureGrid(
          key: Key('asstFigures-$id'),
          tiles: [
            for (final f in asList(card['figures']))
              FigureTile(
                label: s.hindi ? '${f['labelHi'] ?? f['label']}' : '${f['label']}',
                value: '${f['value'] ?? '—'}',
                icon: Icons.info_outline,
              ),
          ],
        ),
      ],
      if (card['kind'] == 'table' && asList(card['rows']).isNotEmpty) ...[
        const SizedBox(height: Tokens.sp2),
        _TableCard(card: card),
      ],
      if (open != null) ...[
        const SizedBox(height: Tokens.sp2),
        OutlinedButton.icon(
          key: Key('asstOpen-${link['app'] ?? link['web']}'),
          icon: const Icon(Icons.open_in_new, size: 18),
          label: Text(
            s.asstOpen(s.hindi ? '${link['labelHi'] ?? link['label']}' : '${link['label']}'),
          ),
          onPressed: open,
        ),
      ],
      if (latest) ...[
        const SizedBox(height: Tokens.sp2),
        _Chips(
          id: 'asstNext',
          title: s.asstNext,
          icon: Icons.arrow_forward,
          questions: [for (final x in asList(d['followUps'])) q(x)],
          onAsk: onAsk,
        ),
        _Chips(
          id: 'asstDidYouMean',
          title: s.asstDidYouMean,
          icon: Icons.help_outline,
          questions: [for (final x in asList(d['didYouMean'])) q(x)],
          onAsk: onAsk,
        ),
        if (asList(d['followUps']).isEmpty && asList(d['didYouMean']).isEmpty)
          _Chips(
            id: 'asstInstead',
            title: s.asstInstead,
            questions: [for (final x in asList(d['suggestions'])) q(x)],
            onAsk: onAsk,
          ),
      ],
    ];
  }

  /// The screen an answer is about: the app's own when the person's menu has it, else the website's page in the
  /// app; none when neither (the website itself refuses a screen the school does not offer).
  VoidCallback? _opener(BuildContext context, S s, Json link, AsyncValue<ProfileMenu> menu) {
    final label = s.hindi ? '${link['labelHi'] ?? link['label']}' : '${link['label']}';
    final app = link['app'] as String?;
    final web = link['web'] as String?;
    // offline (no menu to check against) the app's own screens still open; while it loads, nothing yet
    if (menu.isLoading && !menu.hasValue) return null;
    final m = menu.value;
    final inMenu =
        app != null &&
        (m == null || m.groups.any((g) => g.items.any((i) => i.href.split('?').first == app)));
    final screen = inMenu ? nativeScreen(profile, app, s) : null;
    if (screen != null) return () => pushPage(context, label, screen);
    if (web == null) return null;
    return () => context.push(
      Uri(
        path: '/web',
        queryParameters: {'app': profile.isStaff ? 'teacher' : 'parent', 'to': web, 'title': label},
      ).toString(),
    );
  }
}

/// A short table of records as cards: the first column as the heading, the others as label and value lines.
class _TableCard extends ConsumerWidget {
  const _TableCard({required this.card});
  final Json card;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final cols = asList(card['columns']);
    final rows = asList(card['rows']);
    final more = (card['more'] as num?)?.toInt() ?? 0;
    String label(Json c) => s.hindi ? '${c['labelHi'] ?? c['label']}' : '${c['label']}';
    String value(Json c, Object? v) {
      if (v == null || '$v'.isEmpty) return '—';
      return switch (c['type']) {
        'money' => s.money(v),
        'date' => s.date('$v'),
        _ => '$v',
      };
    }

    if (cols.isEmpty) return const SizedBox.shrink();
    return Column(
      key: const Key('asstTable'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (final r in rows)
          Container(
            margin: const EdgeInsets.only(bottom: Tokens.sp2),
            padding: const EdgeInsets.all(Tokens.sp3),
            decoration: BoxDecoration(
              color: dark ? Tokens.mobGray900 : Tokens.mobWhite,
              borderRadius: BorderRadius.circular(Tokens.radiusSm),
              border: Border.all(color: dark ? Tokens.mobGray700 : Tokens.mobGray200),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  value(cols.first, r[cols.first['key']]),
                  style: const TextStyle(fontWeight: Tokens.fwSemibold),
                ),
                for (final c in cols.skip(1)) FactLine(label(c), value(c, r[c['key']])),
              ],
            ),
          ),
        if (more > 0)
          Text(
            s.asstMore(more),
            style: TextStyle(color: dark ? Tokens.mobGray300 : Tokens.textMuted, fontSize: 13),
          ),
      ],
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
