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
  String get asstOpenProfile => _as('Open profile', 'प्रोफ़ाइल खोलें');
  // docs/design/102: the AI model's help needs the consent that names who runs it
  String get asstModelConsent => _as(
    'The AI model can answer more of your questions. Allow “AI model’s help in the assistant” under Profile → Your consents; until then the assistant answers with its own rules.',
    'AI मॉडल आपके और प्रश्नों के उत्तर दे सकता है। प्रोफ़ाइल → आपकी सहमतियाँ में “AI model’s help in the assistant” चालू करें; तब तक सहायक अपने नियमों से उत्तर देता है।',
  );
  String get asstModelAskParent => _as(
    'For more answers, a parent can allow the AI model’s help under Profile → Your consents in their app.',
    'और उत्तरों के लिए माता-पिता अपने ऐप में प्रोफ़ाइल → आपकी सहमतियाँ में AI मॉडल की सहायता चालू कर सकते हैं।',
  );
  String get asstYou => _as('You', 'आप');
  String get asstAsk => _as('Ask', 'पूछें');
  String get asstNew => _as('New conversation', 'नई बातचीत');
  String get asstEarlier => _as('Earlier conversations', 'पिछली बातचीत');
  String get asstNoEarlier => _as('No earlier conversations yet.', 'अभी कोई पिछली बातचीत नहीं।');
  String get asstClose => _as('Close', 'बंद करें');
  String get asstToday => _as('Today', 'आज');
  String get asstQuick => _as('Your Quick Update', 'आपका त्वरित अपडेट');
  String get asstPlaceholder => _as('Type your question…', 'अपना प्रश्न लिखें…');
  String get asstQuestion => _as('Your question', 'आपका प्रश्न');
  String get asstSend => _as('Send', 'भेजें');
  String get asstTry => _as('Try asking', 'ऐसे पूछें');
  String get asstNext => _as('Ask next', 'आगे पूछें');
  String get asstDidYouMean => _as('Did you mean', 'क्या आपका मतलब है');
  String get asstInstead => _as('You can ask', 'आप पूछ सकते हैं');
  String get asstTopics => _as('Topics', 'विषय');
  String get asstRetry => _as('Try again', 'फिर कोशिश करें');
  String asstOpen(String screen) => _as('Open $screen', '$screen खोलें');
  String asstMore(int n) => _as('and $n more', 'और $n');
  // docs/design/103: a data question's answer
  String asstHow(String how) => _as('How this was worked out: $how', 'यह कैसे निकाला गया: $how');
  String get asstChecked => _as('From a checked question', 'जाँचे हुए प्रश्न से');
  String get asstNoRecords =>
      _as('No records match this question.', 'इस प्रश्न से कोई अभिलेख नहीं मिला।');
  String asstSource(String t) => _as('Source: $t', 'स्रोत: $t');
  String get asstByClaude => _as('Answered with Claude', 'Claude की सहायता से उत्तर');
  String get asstByModel => _as('Answered with the AI model', 'AI मॉडल की सहायता से उत्तर');
  String get asstNeedQuestion =>
      _as('Write a question (at least 2 letters).', 'प्रश्न लिखें (कम से कम 2 अक्षर)।');
  String get asstThinking => _as('Finding the answer…', 'उत्तर खोजा जा रहा है…');
  String get asstPowered => _as('Powered by', 'संचालित:');

  /// "Good evening, Asha! I'm MobiAI. Ask me about attendance, fees … — in English, Hindi or Hinglish."
  String asstGreeting(DateTime now, String? firstName, String name, List<String> topics) {
    final h = now.hour;
    final part = h >= 5 && h < 12
        ? _as('Good morning', 'सुप्रभात')
        : h >= 12 && h < 17
        ? _as('Good afternoon', 'नमस्कार')
        : _as('Good evening', 'शुभ संध्या');
    final who = firstName == null || firstName.isEmpty ? '' : ', $firstName';
    final list = topics.join(', ');
    return hindi
        ? '$part$who! मैं $name हूँ।${list.isEmpty ? '' : ' मुझसे पूछें: $list।'} अंग्रेज़ी, हिन्दी या हिंग्लिश में।'
        : '$part$who! I’m $name.${list.isEmpty ? ' Ask me' : ' Ask me about $list'} — in English, Hindi or Hinglish.';
  }
}

/// The assistant's start for the person (docs/design/91 §C, 92): on, consent, the name and subtitle, the topic bar,
/// Your Quick Update, starters, today's count; and their conversations. Null: not open to them (403).
class AssistantHome {
  const AssistantHome({required this.start, required this.conversations});
  final Json start;
  final List<Json> conversations;

  String get audience => '${start['audience'] ?? 'parent'}';
  bool get on => start['on'] != false;

  /// granted · needed (the parent's own) · ask_parent (a student's parent has not consented) · null (staff)
  String? get consent => start['consent'] as String?;

  /// docs/design/102: the AI model's help — granted · needed · ask_parent · null (does not apply)
  String? get modelConsent => start['modelConsent'] as String?;
  int get askedToday => (start['askedToday'] as num?)?.toInt() ?? 0;
  int get dailyLimit => (start['dailyLimit'] as num?)?.toInt() ?? 0;
  bool get atLimit => dailyLimit > 0 && askedToday >= dailyLimit;
  String get name => '${start['name'] ?? 'MobiAI'}';
  String subtitle(bool hindi) => '${(hindi ? start['subtitleHi'] : start['subtitle']) ?? ''}';
  String? get firstName => start['firstName'] as String?;
  List<Json> get topics => asList(start['topics']);
  List<Json> get quick => asList(start['quick']);
  List<Json> get starters => asList(start['starters']);
}

final assistantHomeProvider = FutureProvider.autoDispose.family<Loaded<AssistantHome?>, Profile>((
  ref,
  p,
) async {
  final api = ref.read(apiProvider);
  try {
    final r = await Future.wait([api.insightsStart(), api.insightsConversations()]);
    return Loaded(
      AssistantHome(start: asJson(r[0]), conversations: asList(asJson(r[1])['data'])),
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

/// Opens the assistant over the app as its own screen (the Ask button on Home, More → Assistant): the chat window's
/// look, with a close button (docs/design/92 phase D).
Future<void> openAssistant(BuildContext context, Profile profile) => Navigator.of(context).push(
  MaterialPageRoute<void>(
    builder: (c) => Scaffold(
      backgroundColor: Tokens.mobNavy800,
      body: SafeArea(
        bottom: false,
        child: AssistantScreen(profile: profile, onClose: () => Navigator.of(c).pop()),
      ),
    ),
  ),
);

/// The topic icons of the topic bar and Your Quick Update.
IconData _topicIcon(String key) => switch (key) {
  'attendance' => Icons.fact_check_outlined,
  'academics' => Icons.menu_book_outlined,
  'exams' => Icons.assignment_outlined,
  'fees' => Icons.account_balance_wallet_outlined,
  'transport' => Icons.directions_bus_outlined,
  'communication' => Icons.campaign_outlined,
  'admissions' => Icons.person_add_alt_outlined,
  'hr' => Icons.groups_outlined,
  'school' => Icons.home_outlined,
  _ => Icons.chat_bubble_outline,
};

String _clock(DateTime t) {
  final l = t.toLocal();
  final h = l.hour % 12 == 0 ? 12 : l.hour % 12;
  return '${h.toString().padLeft(2, '0')}:${l.minute.toString().padLeft(2, '0')} ${l.hour < 12 ? 'am' : 'pm'}';
}

String _lowerFirst(String x) => x.isEmpty ? x : x[0].toLowerCase() + x.substring(1);

/// The assistant in the app for every profile, as the websites' chat window (docs/design/92 phase D): the header with
/// the school's name for it and the audience's subtitle, the topic bar, Today, the greeting and Your Quick Update, the
/// conversation in bubbles with their times (each answer with its records, the screen to open, the source and what to
/// ask next), three dots while it looks, the question bar and "Powered by Mobilise App Lab Limited".
class AssistantScreen extends ConsumerStatefulWidget {
  const AssistantScreen({super.key, required this.profile, this.onClose});
  final Profile profile;

  /// shown as a close button (opened over the app); none inside a tab
  final VoidCallback? onClose;

  @override
  ConsumerState<AssistantScreen> createState() => _AssistantScreenState();
}

/// A question asked here, shown at once (before the conversation is read back).
class _Pending {
  const _Pending(this.text, this.at, this.base);
  final String text;
  final DateTime at;

  /// the conversation's messages when it was asked: shown until the conversation read back has more
  final int base;
}

class _AssistantScreenState extends ConsumerState<AssistantScreen> {
  final _question = TextEditingController();
  final _scroll = ScrollController();
  String? _current;
  _Pending? _pending;
  bool _busy = false;

  /// the API said so when asking (the start may be older than a consent withdrawn or a limit reached meanwhile)
  String? _consent;
  int? _limit;
  String? _error;

  @override
  void dispose() {
    _question.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _toEnd() => WidgetsBinding.instance.addPostFrameCallback((_) {
    if (_scroll.hasClients) {
      _scroll.animateTo(
        _scroll.position.maxScrollExtent,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    }
  });

  Future<void> _ask([String? text]) async {
    final s = ref.read(stringsProvider);
    final q = (text ?? _question.text).trim();
    if (q.length < 2) return setState(() => _error = s.asstNeedQuestion);
    if (_busy) return;
    FocusManager.instance.primaryFocus?.unfocus();
    final base = _current == null
        ? 0
        : asList(ref.read(assistantConversationProvider(_current!)).value?['messages']).length;
    setState(() {
      _busy = true;
      _error = null;
      _pending = _Pending(q, DateTime.now(), base);
    });
    _toEnd();
    try {
      final r = asJson(
        await ref
            .read(apiProvider)
            .insightsAsk(
              body: AskAssistantDto(
                question: q,
                conversationId: _current,
                // the answer in the app's language (auto otherwise: Hinglish stays Hinglish)
                language: s.hindi ? 'hi' : null,
                // the staff app is the teachers' website; families ask as the parents' website
                surface: widget.profile.isStaff ? 'teacher' : 'parent',
              ),
            ),
      );
      if (!mounted) return;
      if (text == null) _question.clear();
      final id = '${r['conversationId']}';
      ref.invalidate(assistantConversationProvider(id));
      setState(() => _current = id);
      await ref.read(assistantConversationProvider(id).future);
      if (!mounted) return;
      ref.invalidate(assistantHomeProvider(widget.profile));
      setState(() {
        _busy = false;
        _pending = null;
      });
      _toEnd();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _pending = null;
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

  void _fresh() {
    setState(() {
      _current = null;
      _pending = null;
      _error = null;
    });
    ref.invalidate(assistantHomeProvider(widget.profile));
  }

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

  Future<void> _earlier(List<Json> conversations) async {
    final s = ref.read(stringsProvider);
    final chosen = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: ListView(
          key: const Key('asstEarlier'),
          shrinkWrap: true,
          children: [
            ListTile(title: Text(s.asstEarlier, style: Theme.of(c).textTheme.titleMedium)),
            if (conversations.isEmpty)
              Padding(padding: const EdgeInsets.all(Tokens.sp4), child: Text(s.asstNoEarlier)),
            for (final x in conversations.take(15))
              ListTile(
                key: Key('asstConv-${x['id']}'),
                leading: const Icon(Icons.chat_bubble_outline),
                title: Text(
                  '${x['title'] ?? '${x['id']}'.substring(0, 8)}',
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text(s.dayShort(DateTime.tryParse('${x['updatedAt']}')?.toLocal() ?? '')),
                selected: x['id'] == _current,
                onTap: () => Navigator.of(c).pop('${x['id']}'),
              ),
          ],
        ),
      ),
    );
    if (chosen != null && mounted) {
      setState(() {
        _current = chosen;
        _error = null;
      });
      _toEnd();
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final value = ref.watch(assistantHomeProvider(widget.profile));
    final home = value.value?.data;
    final blocked = value.hasValue && home == null;
    final consent = _consent ?? home?.consent;
    final waiting = consent == 'needed' || consent == 'ask_parent';
    final limitHit = _limit != null || (home?.atLimit ?? false);
    final on = home?.on ?? true;
    final canAsk = home != null && on && !waiting && !limitHit;
    final conv = _current == null ? null : ref.watch(assistantConversationProvider(_current!));
    final messages = asList(conv?.value?['messages']);
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;

    final log = <Widget>[
      Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: Tokens.sp2, vertical: 2),
          decoration: BoxDecoration(
            color: dark ? Tokens.mobGray700 : Tokens.mobGray100,
            borderRadius: BorderRadius.circular(Tokens.radiusSm),
          ),
          child: Text(s.asstToday, style: const TextStyle(fontSize: 12)),
        ),
      ),
      const SizedBox(height: Tokens.sp3),
      if (blocked)
        _Note(id: 'asstBlocked', text: s.asstBlocked)
      else if (home != null) ...[
        _Bubble(
          key: const Key('asstGreeting'),
          children: [
            Text(
              s.asstGreeting(DateTime.now(), home.firstName, home.name, [
                for (final t in home.topics)
                  s.hindi ? '${t['labelHi'] ?? t['label']}' : _lowerFirst('${t['label']}'),
              ]),
            ),
            if (_current == null && canAsk)
              _Chips(
                id: 'asstStarters',
                title: s.asstTry,
                questions: [
                  for (final x in home.starters.take(4))
                    s.hindi ? '${x['questionHi'] ?? x['question']}' : '${x['question']}',
                ],
                onAsk: _busy ? null : _ask,
              ),
          ],
        ),
        if (home.quick.isNotEmpty)
          _Bubble(
            key: const Key('asstQuick'),
            children: [
              Text(s.asstQuick, style: const TextStyle(fontWeight: Tokens.fwBold)),
              for (final q in home.quick)
                Padding(
                  padding: const EdgeInsets.only(top: Tokens.sp2),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        _topicIcon('${q['topic']}'),
                        size: 18,
                        color: dark ? Tokens.mobCyan500 : Tokens.mobCyan700,
                      ),
                      const SizedBox(width: Tokens.sp2),
                      Expanded(
                        child: Text(s.hindi ? '${q['textHi'] ?? q['text']}' : '${q['text']}'),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        if (canAsk && _current == null && home.modelConsent == 'needed')
          _Note(
            id: 'asstModelConsent',
            text: s.asstModelConsent,
            action: OutlinedButton(
              key: const Key('asstModelProfile'),
              onPressed: _openProfile,
              child: Text(s.asstOpenProfile),
            ),
          )
        else if (canAsk && _current == null && home.modelConsent == 'ask_parent')
          _Note(id: 'asstModelAskParent', text: s.asstModelAskParent),
        if (conv != null && conv.isLoading && !conv.hasValue && _pending == null)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: Tokens.sp3),
            child: LinearProgressIndicator(),
          ),
        ..._thread(context, s, messages, canAsk),
        if (_pending != null && messages.length <= _pending!.base)
          _UserBubble(text: _pending!.text, at: _pending!.at),
        if (_busy)
          _Bubble(
            key: const Key('asstTyping'),
            children: [Semantics(liveRegion: true, label: s.asstThinking, child: const _Dots())],
          ),
        if (!on)
          _Note(id: 'asstOff', text: s.asstOff)
        else if (consent == 'needed')
          _Note(
            id: 'asstConsent',
            text: s.asstConsent,
            action: OutlinedButton(
              key: const Key('asstOpenProfile'),
              onPressed: _openProfile,
              child: Text(s.asstOpenProfile),
            ),
          )
        else if (consent == 'ask_parent')
          _Note(id: 'asstAskParent', text: s.asstAskParent)
        else if (limitHit)
          _Note(
            id: 'asstLimit',
            text: s.asstLimit(
              (_limit ?? 0) > 0
                  ? _limit!
                  : (home.dailyLimit > 0 ? home.dailyLimit : home.askedToday),
            ),
          ),
        if (_error != null) ErrorText(_error!),
      ],
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Header(
          name: home?.name ?? 'MobiAI',
          subtitle: home?.subtitle(s.hindi) ?? '',
          onFresh: home == null || _busy ? null : _fresh,
          onEarlier: home == null ? null : () => _earlier(home.conversations),
          onClose: widget.onClose,
        ),
        Expanded(
          child: ColoredBox(
            color: dark ? Tokens.mobGray900 : Tokens.mobGray50,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (canAsk && home.topics.isNotEmpty)
                  _TopicBar(home: home, onAsk: _busy ? null : _ask),
                Expanded(
                  child: value.hasError && !value.hasValue
                      ? ListView(
                          padding: const EdgeInsets.all(Tokens.sp4),
                          children: [
                            ErrorText(errorText(s, value.error!)),
                            const SizedBox(height: Tokens.sp2),
                            OutlinedButton(
                              key: const Key('asstRetry'),
                              onPressed: () =>
                                  ref.invalidate(assistantHomeProvider(widget.profile)),
                              child: Text(s.asstRetry),
                            ),
                          ],
                        )
                      : !value.hasValue
                      ? const Center(child: CircularProgressIndicator())
                      : ListView(
                          key: const Key('asstLog'),
                          controller: _scroll,
                          padding: const EdgeInsets.all(Tokens.sp3),
                          children: log,
                        ),
                ),
              ],
            ),
          ),
        ),
        ColoredBox(
          color: dark ? Tokens.mobGray900 : Tokens.mobWhite,
          child: SafeArea(
            top: false,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (canAsk)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(Tokens.sp3, Tokens.sp3, Tokens.sp3, 0),
                    child: Row(
                      children: [
                        Expanded(
                          child: TextField(
                            key: const Key('asstQuestion'),
                            controller: _question,
                            minLines: 1,
                            maxLines: 4,
                            maxLength: 1000,
                            textInputAction: TextInputAction.send,
                            onSubmitted: (_) => _ask(),
                            decoration: InputDecoration(
                              labelText: s.asstQuestion,
                              hintText: s.asstPlaceholder,
                              counterText: '',
                              isDense: true,
                              border: const OutlineInputBorder(),
                            ),
                          ),
                        ),
                        const SizedBox(width: Tokens.sp2),
                        IconButton.filled(
                          key: const Key('asstAsk'),
                          tooltip: s.asstSend,
                          style: IconButton.styleFrom(
                            backgroundColor: Tokens.mobNavy800,
                            foregroundColor: Tokens.mobWhite,
                            minimumSize: const Size(48, 48),
                          ),
                          onPressed: _busy ? null : () => _ask(),
                          icon: const Icon(Icons.send_outlined),
                        ),
                      ],
                    ),
                  ),
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: Tokens.sp2),
                  child: Text.rich(
                    TextSpan(
                      text: '${s.asstPowered} ',
                      children: const [
                        TextSpan(
                          text: 'Mobilise App Lab Limited',
                          style: TextStyle(fontWeight: Tokens.fwSemibold),
                        ),
                      ],
                    ),
                    key: const Key('asstFooter'),
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 12, color: muted),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// The conversation's messages as bubbles: on the latest answer, what to ask next.
  List<Widget> _thread(BuildContext context, S s, List<Json> messages, bool canAsk) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final last = messages.lastIndexWhere((m) => m['role'] == 'assistant');
    String q(Json x) => '${x['question'] ?? x['title'] ?? ''}';
    final out = <Widget>[];
    for (final (i, m) in messages.indexed) {
      if (m['role'] == 'user') {
        out.add(
          _UserBubble(
            text: '${m['content'] ?? ''}',
            at: DateTime.tryParse('${m['createdAt']}') ?? DateTime.now(),
          ),
        );
        continue;
      }
      final d = asJson(m['display']);
      final card = asJson(d['card']);
      final link = asJson(d['link']);
      final open = link.isEmpty ? null : _opener(context, s, link);
      final latest = i == last && canAsk && !_busy;
      final citations = asList(m['citations']);
      out.add(
        _Bubble(
          key: Key('asstAnswer-$i'),
          at: DateTime.tryParse('${m['createdAt']}'),
          children: [
            Text('${m['content'] ?? ''}'),
            if (card['kind'] == 'figures' && asList(card['figures']).isNotEmpty) ...[
              const SizedBox(height: Tokens.sp2),
              FigureGrid(
                key: Key('asstFigures-$_current'),
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
            // docs/design/103: a data question — figures, sentences, a chart and the table
            if (card['kind'] == 'data') ...[
              const SizedBox(height: Tokens.sp2),
              _DataCard(key: Key('asstData-$i'), card: card),
            ],
            if (open != null)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  key: Key('asstOpen-${link['app'] ?? link['web']}'),
                  icon: const Icon(Icons.open_in_new, size: 18),
                  label: Text(
                    s.asstOpen(
                      s.hindi ? '${link['labelHi'] ?? link['label']}' : '${link['label']}',
                    ),
                  ),
                  onPressed: open,
                ),
              ),
            // docs/design/93: a question EduPro's own rules could not place, answered with Claude's help;
            // docs/design/101: or with the AI model set up for all schools
            if (d['by'] == 'claude' || d['by'] == 'llm')
              Padding(
                key: Key('asstByClaude-$i'),
                padding: const EdgeInsets.only(top: Tokens.sp1),
                child: Row(
                  children: [
                    Icon(
                      Icons.auto_awesome_outlined,
                      size: 14,
                      color: dark ? Tokens.mobCyan500 : Tokens.mobCyan700,
                    ),
                    const SizedBox(width: Tokens.sp1),
                    Flexible(
                      child: Text(
                        d['by'] == 'llm' ? s.asstByModel : s.asstByClaude,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: Tokens.fwSemibold,
                          color: dark ? Tokens.mobGray100 : Tokens.textMuted,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            if (citations.isNotEmpty)
              Text(
                s.asstSource(citations.map((c) => '${c['title']}').join(', ')),
                style: TextStyle(fontSize: 12, color: dark ? Tokens.mobGray300 : Tokens.textMuted),
              ),
            if (latest) ...[
              _Chips(
                id: 'asstNext',
                title: s.asstNext,
                questions: [for (final x in asList(d['followUps'])) q(x)],
                onAsk: _ask,
              ),
              _Chips(
                id: 'asstDidYouMean',
                title: s.asstDidYouMean,
                questions: [for (final x in asList(d['didYouMean'])) q(x)],
                onAsk: _ask,
              ),
              if (asList(d['followUps']).isEmpty && asList(d['didYouMean']).isEmpty)
                _Chips(
                  id: 'asstInstead',
                  title: s.asstInstead,
                  questions: [for (final x in asList(d['suggestions'])) q(x)],
                  onAsk: _ask,
                ),
            ],
          ],
        ),
      );
    }
    return out;
  }

  /// The screen an answer is about: the app's own when the person's menu has it, else the website's page in the
  /// app; none when neither (the website itself refuses a screen the school does not offer).
  VoidCallback? _opener(BuildContext context, S s, Json link) {
    final label = s.hindi ? '${link['labelHi'] ?? link['label']}' : '${link['label']}';
    final app = link['app'] as String?;
    final web = link['web'] as String?;
    final menu = ref.watch(menuProvider(widget.profile.id));
    // offline (no menu to check against) the app's own screens still open; while it loads, nothing yet
    if (menu.isLoading && !menu.hasValue) return null;
    final m = menu.value;
    final inMenu =
        app != null &&
        (m == null || m.groups.any((g) => g.items.any((i) => i.href.split('?').first == app)));
    final screen = inMenu ? nativeScreen(widget.profile, app, s) : null;
    if (screen != null) return () => pushPage(context, label, screen);
    if (web == null) return null;
    return () => context.push(
      Uri(
        path: '/web',
        queryParameters: {
          'app': widget.profile.isStaff ? 'teacher' : 'parent',
          'to': web,
          'title': label,
        },
      ).toString(),
    );
  }
}

/// The navy top: the icon, the school's name for the assistant with the audience's subtitle and a green dot; earlier
/// conversations, a new conversation and (opened over the app) close.
class _Header extends ConsumerWidget {
  const _Header({
    required this.name,
    required this.subtitle,
    required this.onFresh,
    required this.onEarlier,
    required this.onClose,
  });
  final String name;
  final String subtitle;
  final VoidCallback? onFresh;
  final VoidCallback? onEarlier;
  final VoidCallback? onClose;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    Widget tool(String key, IconData icon, String tip, VoidCallback? on) => Padding(
      padding: const EdgeInsets.only(left: Tokens.sp1),
      child: IconButton(
        key: Key(key),
        tooltip: tip,
        onPressed: on,
        style: IconButton.styleFrom(
          backgroundColor: Tokens.mobNavy700,
          foregroundColor: Tokens.mobWhite,
          disabledBackgroundColor: Tokens.mobNavy700,
          disabledForegroundColor: Tokens.mobNavy100,
          minimumSize: const Size(48, 48),
        ),
        icon: Icon(icon),
      ),
    );
    return Container(
      color: Tokens.mobNavy800,
      padding: const EdgeInsets.fromLTRB(Tokens.sp4, Tokens.sp2, Tokens.sp2, Tokens.sp3),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: Tokens.mobNavy700,
              borderRadius: BorderRadius.circular(Tokens.radiusMd),
            ),
            child: const Icon(Icons.auto_awesome_outlined, color: Tokens.mobWhite),
          ),
          const SizedBox(width: Tokens.sp3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(
                  header: true,
                  child: Text(
                    name,
                    key: const Key('asstName'),
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleMedium
                        ?.copyWith(color: Tokens.mobWhite, fontWeight: Tokens.fwSemibold),
                  ),
                ),
                if (subtitle.isNotEmpty)
                  Row(
                    children: [
                      Container(
                        width: 8,
                        height: 8,
                        decoration: const BoxDecoration(
                          color: Tokens.mobGreen600,
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: Tokens.sp1),
                      Flexible(
                        child: Text(
                          subtitle,
                          key: const Key('asstSubtitle'),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(color: Tokens.mobNavy100, fontSize: 13),
                        ),
                      ),
                    ],
                  ),
              ],
            ),
          ),
          tool('asstEarlierBtn', Icons.history, s.asstEarlier, onEarlier),
          tool('asstNew', Icons.delete_outline, s.asstNew, onFresh),
          if (onClose != null) tool('asstClose', Icons.close, s.asstClose, onClose),
        ],
      ),
    );
  }
}

/// The topic bar: each topic the person may ask; a tap asks its main question.
class _TopicBar extends ConsumerWidget {
  const _TopicBar({required this.home, required this.onAsk});
  final AssistantHome home;
  final void Function(String)? onAsk;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Semantics(
      label: s.asstTopics,
      container: true,
      explicitChildNodes: true,
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: dark ? Tokens.mobGray900 : Tokens.mobWhite,
          border: Border(bottom: BorderSide(color: dark ? Tokens.mobGray700 : Tokens.mobGray100)),
        ),
        child: SingleChildScrollView(
          key: const Key('asstTopics'),
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: Tokens.sp3, vertical: Tokens.sp2),
          child: Row(
            children: [
              for (final t in home.topics)
                Padding(
                  padding: const EdgeInsets.only(right: Tokens.sp2),
                  child: OutlinedButton.icon(
                    key: Key('asstTopic-${t['key']}'),
                    style: OutlinedButton.styleFrom(minimumSize: const Size(48, 48)),
                    icon: Icon(_topicIcon('${t['key']}'), size: 18),
                    label: Text(s.hindi ? '${t['labelHi'] ?? t['label']}' : '${t['label']}'),
                    onPressed: onAsk == null
                        ? null
                        : () => onAsk!(
                            s.hindi ? '${t['questionHi'] ?? t['question']}' : '${t['question']}',
                          ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The assistant's bubble (left, with the small icon) and its time.
class _Bubble extends StatelessWidget {
  const _Bubble({super.key, required this.children, this.at});
  final List<Widget> children;
  final DateTime? at;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Padding(
      padding: const EdgeInsets.only(bottom: Tokens.sp3, right: Tokens.sp5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Container(
            width: 28,
            height: 28,
            decoration: const BoxDecoration(color: Tokens.mobNavy800, shape: BoxShape.circle),
            child: const Icon(Icons.auto_awesome_outlined, size: 15, color: Tokens.mobWhite),
          ),
          const SizedBox(width: Tokens.sp2),
          Flexible(
            child: Container(
              padding: const EdgeInsets.all(Tokens.sp3),
              decoration: BoxDecoration(
                // dark: deep navy, so links and muted words keep their contrast
                color: dark ? Tokens.mobNavy900 : Tokens.mobWhite,
                border: Border.all(color: dark ? Tokens.mobGray700 : Tokens.mobGray100),
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(Tokens.radiusLg),
                  topRight: Radius.circular(Tokens.radiusLg),
                  bottomRight: Radius.circular(Tokens.radiusLg),
                  bottomLeft: Radius.circular(Tokens.radiusSm),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  ...children,
                  if (at != null) ...[
                    const SizedBox(height: Tokens.sp1),
                    Text(
                      _clock(at!),
                      style: TextStyle(
                        fontSize: 12,
                        color: dark ? Tokens.mobGray100 : Tokens.textMuted,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The person's question (right, navy) and its time.
class _UserBubble extends ConsumerWidget {
  const _UserBubble({required this.text, required this.at});
  final String text;
  final DateTime at;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return Padding(
      padding: const EdgeInsets.only(bottom: Tokens.sp3, left: Tokens.sp7),
      child: Align(
        alignment: Alignment.centerRight,
        child: Semantics(
          label: '${s.asstYou}: $text',
          excludeSemantics: true,
          child: Container(
            padding: const EdgeInsets.all(Tokens.sp3),
            decoration: const BoxDecoration(
              color: Tokens.mobNavy800,
              borderRadius: BorderRadius.only(
                topLeft: Radius.circular(Tokens.radiusLg),
                topRight: Radius.circular(Tokens.radiusLg),
                bottomLeft: Radius.circular(Tokens.radiusLg),
                bottomRight: Radius.circular(Tokens.radiusSm),
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(text, style: const TextStyle(color: Tokens.mobWhite)),
                const SizedBox(height: Tokens.sp1),
                Text(_clock(at), style: const TextStyle(color: Tokens.mobNavy100, fontSize: 12)),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Three dots while the answer is found.
class _Dots extends StatefulWidget {
  const _Dots();
  @override
  State<_Dots> createState() => _DotsState();
}

class _DotsState extends State<_Dots> with SingleTickerProviderStateMixin {
  late final AnimationController _c = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // still for those who asked for less motion
    if (MediaQuery.of(context).disableAnimations) {
      _c.stop();
    } else if (!_c.isAnimating) {
      _c.repeat();
    }
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return AnimatedBuilder(
      animation: _c,
      builder: (_, _) => Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (var i = 0; i < 3; i++)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 2, vertical: Tokens.sp1),
              child: Opacity(
                opacity: (_c.value * 3).floor() == i ? 1 : 0.35,
                child: Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: dark ? Tokens.mobGray100 : Tokens.textMuted,
                    shape: BoxShape.circle,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// A note in a bordered box (not open, switched off, consent, today's limit), read out when it appears.
class _Note extends StatelessWidget {
  const _Note({required this.id, required this.text, this.action});
  final String id;
  final String text;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      key: Key(id),
      margin: const EdgeInsets.only(bottom: Tokens.sp3),
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

/// Questions to tap (starters, ask next, did you mean, you can ask): a tap asks it.
class _Chips extends StatelessWidget {
  const _Chips({
    required this.id,
    required this.title,
    required this.questions,
    required this.onAsk,
  });
  final String id;
  final String title;
  final List<String> questions;
  final void Function(String)? onAsk;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final shown = questions.where((q) => q.trim().isNotEmpty).toSet().toList();
    if (shown.isEmpty) return const SizedBox.shrink();
    return Padding(
      key: Key(id),
      padding: const EdgeInsets.only(top: Tokens.sp2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: TextStyle(
              color: dark ? Tokens.mobGray100 : Tokens.textMuted,
              fontSize: 13,
              fontWeight: Tokens.fwSemibold,
            ),
          ),
          const SizedBox(height: Tokens.sp1),
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp1,
            children: [
              for (final (i, q) in shown.indexed)
                ActionChip(
                  key: Key('$id-$i'),
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
            padding: const EdgeInsets.all(Tokens.sp2),
            decoration: BoxDecoration(
              color: dark ? Tokens.mobGray900 : Tokens.mobGray50,
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

/// docs/design/103: a data question's answer — the title, how it was worked out, the figures, the sentences, a chart
/// and the table (the chart is drawn from the same rows as the table, so they always agree).
class _DataCard extends ConsumerWidget {
  const _DataCard({super.key, required this.card});
  final Json card;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final rows = asList(card['rows']);
    final figures = asList(card['figures']);
    // the sentences are plain strings (asList keeps only objects)
    final text = [for (final t in (card['text'] is List ? card['text'] as List : const [])) '$t'];
    final hasRows = rows.isNotEmpty && asList(card['columns']).isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if ('${card['title'] ?? ''}'.isNotEmpty)
          Text('${card['title']}', style: const TextStyle(fontWeight: Tokens.fwBold)),
        if ('${card['explain'] ?? ''}'.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(
              s.asstHow('${card['explain']}'),
              style: TextStyle(fontSize: 12, color: muted),
            ),
          ),
        if (figures.isNotEmpty) ...[
          const SizedBox(height: Tokens.sp2),
          FigureGrid(
            tiles: [
              for (final f in figures)
                FigureTile(
                  label: s.hindi ? '${f['labelHi'] ?? f['label']}' : '${f['label']}',
                  value: '${f['value'] ?? '—'}',
                  icon: Icons.insights_outlined,
                ),
            ],
          ),
        ],
        for (final t in text)
          Padding(
            padding: const EdgeInsets.only(top: Tokens.sp2),
            child: Text(t),
          ),
        if (hasRows && card['chart'] is Map && rows.length >= 2) ...[
          const SizedBox(height: Tokens.sp3),
          _DataChart(card: card),
        ],
        if (hasRows) ...[
          const SizedBox(height: Tokens.sp2),
          _TableCard(card: {'columns': card['columns'], 'rows': rows, 'more': card['more']}),
        ] else
          Padding(
            padding: const EdgeInsets.only(top: Tokens.sp2),
            child: Text(s.asstNoRecords),
          ),
        if (card['checked'] == true)
          Padding(
            padding: const EdgeInsets.only(top: Tokens.sp1),
            child: Text(s.asstChecked, style: TextStyle(fontSize: 12, color: muted)),
          ),
      ],
    );
  }
}

double? _chartNumber(Object? v) => v is num ? v.toDouble() : double.tryParse('$v');

/// The chart of a data answer: bars (side by side or stacked), a line or a ring, drawn natively; its legend is text and
/// a screen reader hears the values.
class _DataChart extends ConsumerWidget {
  const _DataChart({required this.card});
  final Json card;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final chart = asJson(card['chart']);
    final type = '${chart['type']}';
    final x = '${chart['x']}';
    final ys = [for (final y in (chart['y'] is List ? chart['y'] as List : const [])) '$y'];
    final rows = asList(card['rows']).map(asJson).toList();
    final cols = asList(card['columns']).map(asJson).toList();
    String name(String key) =>
        '${cols.firstWhere((c) => c['key'] == key, orElse: () => {'label': key})['label']}';
    final labels = [for (final r in rows) '${r[x] ?? '—'}'];
    final values = [
      for (final y in ys) [for (final r in rows) _chartNumber(r[y]) ?? 0],
    ];
    final palette = (dark
        ? [
            Tokens.mobCyan500,
            Tokens.mobGreen600,
            Tokens.mobAmber600,
            Tokens.mobGray300,
            Tokens.mobRed600,
            Tokens.mobCyan100,
            Tokens.mobNavy100,
            Tokens.mobGray500,
          ]
        : [
            Tokens.mobNavy700,
            Tokens.mobCyan700,
            Tokens.mobGreen600,
            Tokens.mobAmber600,
            Tokens.mobRed600,
            Tokens.mobGray500,
            Tokens.mobNavy100,
            Tokens.mobCyan100,
          ]);
    final axis = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final heard = [
      '${card['title'] ?? ''}.',
      for (final (i, l) in labels.indexed)
        '$l: ${[for (final v in values) _plain(v[i])].join(', ')}',
    ].join(' ');
    final legend = type == 'donut'
        ? [for (final (i, l) in labels.indexed) (l, palette[i % palette.length])]
        : [for (final (i, y) in ys.indexed) (name(y), palette[i % palette.length])];
    return Semantics(
      label: heard,
      excludeSemantics: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            key: const Key('asstChart'),
            height: type == 'donut' ? 160 : 180,
            width: double.infinity,
            child: CustomPaint(
              painter: _ChartPainter(
                type: type,
                labels: labels,
                values: values,
                palette: palette,
                axis: axis,
              ),
            ),
          ),
          const SizedBox(height: Tokens.sp1),
          Wrap(
            spacing: Tokens.sp3,
            runSpacing: Tokens.sp1,
            children: [
              for (final (label, colour) in legend)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(width: 10, height: 10, color: colour),
                    const SizedBox(width: 4),
                    Text(label, style: TextStyle(fontSize: 12, color: axis)),
                  ],
                ),
            ],
          ),
        ],
      ),
    );
  }
}

String _plain(double v) => v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(2);

class _ChartPainter extends CustomPainter {
  _ChartPainter({
    required this.type,
    required this.labels,
    required this.values,
    required this.palette,
    required this.axis,
  });
  final String type;
  final List<String> labels;
  final List<List<double>> values;
  final List<Color> palette;
  final Color axis;

  @override
  void paint(Canvas canvas, Size size) {
    if (labels.isEmpty || values.isEmpty) return;
    if (type == 'donut') return _donut(canvas, size);
    const left = 4.0;
    const bottom = 18.0;
    final h = size.height - bottom;
    final w = size.width - left;
    final stacked = type == 'stacked_bar';
    final tops = [
      for (var i = 0; i < labels.length; i++)
        stacked
            ? values.fold<double>(0, (s, v) => s + (v[i] > 0 ? v[i] : 0))
            : values.map((v) => v[i]).fold<double>(0, (a, b) => b > a ? b : a),
    ];
    final max = tops.fold<double>(0, (a, b) => b > a ? b : a);
    if (max <= 0) return;
    final base = Paint()
      ..color = axis.withValues(alpha: 0.5)
      ..strokeWidth = 1;
    canvas.drawLine(Offset(left, h), Offset(size.width, h), base);
    final step = w / labels.length;
    if (type == 'line') {
      for (final (si, series) in values.indexed) {
        final paint = Paint()
          ..color = palette[si % palette.length]
          ..strokeWidth = 2.5
          ..style = PaintingStyle.stroke;
        final path = Path();
        for (var i = 0; i < series.length; i++) {
          final p = Offset(left + step * i + step / 2, h - (series[i] / max) * (h - 6));
          i == 0 ? path.moveTo(p.dx, p.dy) : path.lineTo(p.dx, p.dy);
          canvas.drawCircle(p, 3, Paint()..color = palette[si % palette.length]);
        }
        canvas.drawPath(path, paint);
      }
    } else {
      final groupW = step * 0.7;
      for (var i = 0; i < labels.length; i++) {
        var y = h;
        for (final (si, series) in values.indexed) {
          final v = series[i] > 0 ? series[i] : 0.0;
          final bh = (v / max) * (h - 6);
          final paint = Paint()..color = palette[si % palette.length];
          if (stacked) {
            canvas.drawRect(
              Rect.fromLTWH(left + step * i + (step - groupW) / 2, y - bh, groupW, bh),
              paint,
            );
            y -= bh;
          } else {
            final bw = groupW / values.length;
            canvas.drawRect(
              Rect.fromLTWH(left + step * i + (step - groupW) / 2 + bw * si, h - bh, bw - 1, bh),
              paint,
            );
          }
        }
      }
    }
    // the labels under the axis: as many as fit
    final every = (labels.length / (w / 48)).ceil().clamp(1, labels.length);
    for (var i = 0; i < labels.length; i += every) {
      final tp = TextPainter(
        text: TextSpan(
          text: labels[i],
          style: TextStyle(fontSize: 10, color: axis),
        ),
        textDirection: TextDirection.ltr,
        maxLines: 1,
        ellipsis: '…',
      )..layout(maxWidth: step * every - 2);
      tp.paint(canvas, Offset(left + step * i + (step - tp.width) / 2, h + 3));
    }
  }

  void _donut(Canvas canvas, Size size) {
    final series = values.first;
    final total = series.fold<double>(0, (s, v) => s + (v > 0 ? v : 0));
    if (total <= 0) return;
    final r = (size.height / 2) - 8;
    final rect = Rect.fromCircle(center: Offset(size.width / 2, size.height / 2), radius: r);
    var start = -3.14159 / 2;
    for (final (i, v) in series.indexed) {
      if (v <= 0) continue;
      final sweep = (v / total) * 2 * 3.14159;
      canvas.drawArc(
        rect,
        start,
        sweep,
        false,
        Paint()
          ..color = palette[i % palette.length]
          ..style = PaintingStyle.stroke
          ..strokeWidth = 22,
      );
      start += sweep;
    }
  }

  @override
  bool shouldRepaint(covariant _ChartPainter old) => old.values != values || old.type != type;
}
