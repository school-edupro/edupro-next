import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../staff/data.dart' show PickedFile, uploadFile;
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'attendance.dart' show leaveFilePickerProvider;
import '../ui/paged_feed.dart';
import 'common.dart';
import 'data.dart';

/// The words of the queries (as the website's, in English and Hindi).
extension QueryWords on S {
  String _q(String en, String hi) => hindi ? hi : en;

  String get qryTitle => _q('Queries, complaints and leave', 'प्रश्न, शिकायतें और अवकाश');
  String qryCount(int n, bool filtered) =>
      '${filtered ? _q('$n found', '$n मिले') : _q('$n in all', 'कुल $n')} · ${_q('latest first', 'नवीनतम पहले')}';
  String get qryNew => _q('New request', 'नया अनुरोध');
  String get qryAll => _q('All', 'सभी');
  String get qryNotClosed => _q('Not closed', 'बंद नहीं');
  String qryStatus(String st) => switch (st) {
    'in_progress' => _q('In progress', 'प्रक्रिया में'),
    'answered' => _q('Answered', 'उत्तर मिला'),
    'closed' => _q('Closed', 'बंद'),
    _ => _q('Open', 'खुला'),
  };
  String qryKind(String k) => switch (k) {
    'complaint' => _q('Complaint', 'शिकायत'),
    'leave' => _q('Leave request', 'अवकाश अनुरोध'),
    _ => _q('Query', 'प्रश्न'),
  };
  String qryDecision(String d) =>
      d == 'approved' ? _q('Approved', 'स्वीकृत') : _q('Not approved', 'स्वीकृत नहीं');
  String get qryStatusLabel => _q('Status', 'स्थिति');
  String get qryTypeLabel => _q('Type', 'प्रकार');
  String get qrySearch => _q('Number or subject', 'क्रमांक या विषय');
  String get qryNone => _q(
    'No queries yet. Use New request to ask the school something, report a problem or apply for leave.',
    'अभी कोई प्रश्न नहीं। विद्यालय से कुछ पूछने या समस्या बताने के लिए "नया अनुरोध" चुनें।',
  );
  String get qryFeedback => _q('Quick feedback', 'त्वरित प्रतिक्रिया');
  String get qryArea => _q('Area', 'क्षेत्र');
  String qryAreaName(String a) => switch (a) {
    'transport' => _q('Transport', 'परिवहन'),
    'fees' => _q('Fees', 'फ़ीस'),
    'facilities' => _q('Facilities', 'सुविधाएँ'),
    'communication' => _q('Communication', 'संवाद'),
    'app' => _q('Parent app', 'अभिभावक ऐप'),
    _ => _q('Teaching', 'शिक्षण'),
  };
  String get qryRating => _q('Rating', 'रेटिंग');
  String qryStar(int n) => _q('$n of 5 stars', '5 में से $n तारे');
  String get qryComment => _q('Comment (optional)', 'टिप्पणी (वैकल्पिक)');
  String get qrySendFeedback => _q('Send feedback', 'प्रतिक्रिया भेजें');
  String get qryThanks => _q('Thank you for your feedback.', 'आपकी प्रतिक्रिया के लिए धन्यवाद।');
  String get qryChooseRating => _q('Choose a rating.', 'रेटिंग चुनें।');
  String get qryNewHelp => _q(
    'A query or a complaint for your child. Leave is applied for under Attendance.',
    'आपके बच्चे के लिए एक प्रश्न या शिकायत। अवकाश के लिए उपस्थिति में आवेदन करें।',
  );
  String get qryAbout => _q('About', 'किस बारे में');
  String get qrySubject => _q('Subject', 'विषय');
  String get qryDetails => _q('Details', 'विवरण');
  String get qryFiles => _q('Attachments (optional)', 'संलग्नक (वैकल्पिक)');
  String get qryFilesHelp => _q(
    'PDF or photos, up to 5 files of 5 MB each.',
    'PDF या फ़ोटो, 5 MB तक की अधिकतम 5 फ़ाइलें।',
  );
  String get qryAddFile => _q('Add a file', 'फ़ाइल जोड़ें');
  String qryRemoveFile(String name) => _q('Remove $name', '$name हटाएँ');
  String get qrySend => _q('Send', 'भेजें');
  String get qryNeedSubject =>
      _q('Write a subject (at least 3 letters).', 'विषय लिखें (कम से कम 3 अक्षर)।');
  String get qryNeedDetails => _q('Write the details.', 'विवरण लिखें।');
  String get qryFileWrong => _q(
    'Add PDFs or photos of 5 MB or less, up to 5 files.',
    '5 MB तक की PDF या फ़ोटो, अधिकतम 5 फ़ाइलें जोड़ें।',
  );
  String qryOpened(String student, String day) =>
      _q('$student · opened $day', '$student · $day को खोला');
  String qryHandledBy(String who) => _q('handled by $who', '$who देख रहे हैं');
  String get qryYou => _q('You', 'आप');
  String get qrySchool => _q('School', 'विद्यालय');
  String qryLeave(String from, String to) => _q('Leave $from → $to', 'अवकाश $from → $to');
  String get qryReply => _q('Reply', 'जवाब दें');
  String get qrySaved => _q('Saved.', 'सहेजा गया।');
  String get qryResolution => _q('Resolution', 'समाधान');
  String get qryNotResolved => _q('Not resolved?', 'समाधान नहीं हुआ?');
  String get qryWhyReopen => _q('Why are you reopening it?', 'आप इसे फिर से क्यों खोल रहे हैं?');
  String qryReopenUntil(String d) =>
      _q('You can reopen it until $d', 'आप इसे $d तक फिर से खोल सकते हैं');
  String get qryReopen => _q('Reopen', 'फिर से खोलें');
  String get qryNeedReason =>
      _q('Write why (at least 3 letters).', 'कारण लिखें (कम से कम 3 अक्षर)।');
  String get qryHowHandled => _q('How was this handled?', 'यह कैसे संभाला गया?');
  String get qryRate => _q('Rate', 'रेटिंग दें');
  String qryYouRated(int n) => _q('You rated this $n of 5', 'आपने इसे 5 में से $n दिया');
  String qryAttachment(int i, String who) => _q('Attachment $i · $who', 'संलग्नक $i · $who');
}

/// The tone of a query's status chip.
Tone queryStatusTone(String st) => switch (st) {
  'in_progress' => Tone.info,
  'answered' => Tone.success,
  'closed' => Tone.neutral,
  _ => Tone.warning,
};

/// One query in full, and (not for leave) the helpdesk's reopen window and resolution.
final queryProvider = FutureProvider.autoDispose.family<(Json, Json?), String>((ref, id) async {
  final api = ref.read(apiProvider);
  final q = asJson(await api.engagementGetMine(id: id));
  Json? hd;
  if (q['kind'] != 'leave') {
    try {
      hd = asJson(await api.engagementMyTimeline(id: id));
    } catch (_) {
      hd = null; // the reopen and the resolution are left out, as on the website
    }
  }
  return (q, hd);
});

final _categoriesProvider = FutureProvider.autoDispose<List<Json>>(
  (ref) async => asList(asJson(await ref.read(apiProvider).engagementMyCategories())['data']),
);

/// Opens a query in full; `saved`: just sent or answered.
void openQuery(BuildContext context, Profile profile, String id, {bool saved = false}) {
  final s = ProviderScope.containerOf(context, listen: false).read(stringsProvider);
  pushPage(context, s.qryDetails, QueryDetail(profile: profile, id: id, saved: saved));
}

/// Five stars to choose from (each labelled for the screen reader).
class QueryStars extends StatelessWidget {
  const QueryStars({
    super.key,
    required this.value,
    required this.onChanged,
    required this.s,
    required this.name,
  });
  final int value;
  final ValueChanged<int> onChanged;
  final S s;
  final String name;

  @override
  Widget build(BuildContext context) => Wrap(
    children: [
      for (var n = 1; n <= 5; n++)
        IconButton(
          key: Key('$name-$n'),
          tooltip: s.qryStar(n),
          isSelected: n <= value,
          icon: Icon(
            n <= value ? Icons.star : Icons.star_border,
            color: (n <= value ? Tokens.statusWarning : null),
          ),
          onPressed: () => onChanged(n),
        ),
    ],
  );
}

/// The queries as the website's page: how many, the status, the type and a search, the latest 10 first and 10
/// more as the family scrolls; each with its
/// subject, number, type, about, child, day, status, the leave decision and the rating; New request; and quick
/// feedback to the school.
class QueriesScreen extends ConsumerStatefulWidget {
  const QueriesScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<QueriesScreen> createState() => _QueriesScreenState();
}

class _QueriesScreenState extends ConsumerState<QueriesScreen> {
  String _status = '';
  String _kind = '';
  String _q = '';
  final _words = TextEditingController();
  String _area = 'teaching';
  int _rating = 0;
  final _comment = TextEditingController();
  String? _message;
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _words.dispose();
    _comment.dispose();
    super.dispose();
  }

  bool get _filtered => _status.isNotEmpty || _kind.isNotEmpty || _q.isNotEmpty;

  Future<void> _new() async {
    final s = ref.read(stringsProvider);
    final id = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => FamilyPage(
          title: s.qryNew,
          child: QueryForm(profile: widget.profile),
        ),
      ),
    );
    if (!mounted) return;
    ref.read(feedRoundProvider('family-queries').notifier).bump();
    if (id != null) openQuery(context, widget.profile, id, saved: true);
  }

  Future<void> _feedback() async {
    final s = ref.read(stringsProvider);
    if (_rating == 0) return setState(() => _error = s.qryChooseRating);
    setState(() {
      _busy = true;
      _error = null;
      _message = null;
    });
    try {
      await ref
          .read(apiProvider)
          .engagementCreateFeedback(
            body: CreateFeedbackDto(
              studentId: widget.profile.studentId,
              category: _area,
              rating: _rating,
              comment: _comment.text.trim().isEmpty ? null : _comment.text.trim(),
            ),
          );
      setState(() {
        _busy = false;
        _message = s.qryThanks;
        _rating = 0;
        _comment.clear();
      });
    } catch (e) {
      setState(() {
        _busy = false;
        _error = errorText(s, e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    Widget chips(
      String name,
      List<(String, String)> items,
      String value,
      ValueChanged<String> on,
    ) => Wrap(
      spacing: Tokens.sp2,
      runSpacing: Tokens.sp2,
      children: [
        for (final (v, label) in items)
          ChoiceChip(
            key: Key('$name-${v.isEmpty ? 'all' : v}'),
            label: Text(label),
            selected: value == v,
            showCheckmark: false,
            onSelected: (_) => on(v),
          ),
      ],
    );
    // a new request, a reply or a rating elsewhere: the list loads again from the newest
    final round = ref.watch(feedRoundProvider('family-queries'));
    return PagedFeed(
      key: ValueKey('qryFeed-$_status-$_kind-$_q-$round'),
      firstCacheKey: _filtered ? null : 'queries-feed:${widget.profile.id}',
      load: (page) => ref
          .read(apiProvider)
          .engagementMine(
            studentId: widget.profile.studentId,
            status: _status.isEmpty ? null : _status,
            kind: _kind.isEmpty ? null : _kind,
            q: _q.isEmpty ? null : _q,
            order: 'latest',
            page: page,
            size: 10,
          ),
      parse: (a, page) {
        final total = ((asJson(a['page'])['total'] as num?) ?? 0).toInt();
        return (items: asList(a['data']), more: page * 10 < total, total: total);
      },
      empty: _filtered ? s.nothingMatches : s.qryNone,
      header: (total, _) => [
        Text(
          s.qryTitle,
          style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
        ),
        if (total != null)
          Text(
            s.qryCount(total, _filtered),
            key: const Key('qryCount'),
            style: TextStyle(color: muted, fontSize: 14),
          ),
        const SizedBox(height: Tokens.sp3),
        FilledButton.icon(
          key: const Key('qryNew'),
          icon: const Icon(Icons.add),
          label: Text(s.qryNew),
          onPressed: _new,
        ),
        const SizedBox(height: Tokens.sp3),
        if (_message != null) ...[Notice(text: _message!), const SizedBox(height: Tokens.sp3)],
        Card(
          child: Padding(
            padding: const EdgeInsets.all(Tokens.sp3),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(s.qryStatusLabel, style: TextStyle(color: muted, fontSize: 13)),
                const SizedBox(height: Tokens.sp1),
                chips(
                  'qryStatus',
                  [
                    ('', s.qryAll),
                    ('active', s.qryNotClosed),
                    for (final v in const ['open', 'in_progress', 'answered', 'closed'])
                      (v, s.qryStatus(v)),
                  ],
                  _status,
                  (v) => setState(() => _status = v),
                ),
                const SizedBox(height: Tokens.sp2),
                Text(s.qryTypeLabel, style: TextStyle(color: muted, fontSize: 13)),
                const SizedBox(height: Tokens.sp1),
                chips(
                  'qryKind',
                  [
                    ('', s.qryAll),
                    for (final v in const ['query', 'complaint', 'leave']) (v, s.qryKind(v)),
                  ],
                  _kind,
                  (v) => setState(() => _kind = v),
                ),
                const SizedBox(height: Tokens.sp2),
                TextField(
                  key: const Key('qrySearch'),
                  controller: _words,
                  maxLength: 80,
                  textInputAction: TextInputAction.search,
                  decoration: InputDecoration(
                    labelText: s.qrySearch,
                    prefixIcon: const Icon(Icons.search),
                    border: const OutlineInputBorder(),
                    counterText: '',
                  ),
                  onSubmitted: (v) => setState(() => _q = v.trim()),
                ),
                if (_filtered)
                  Align(
                    alignment: AlignmentDirectional.centerEnd,
                    child: TextButton(
                      key: const Key('qryClear'),
                      onPressed: () => setState(() {
                        _status = '';
                        _kind = '';
                        _q = '';
                        _words.clear();
                      }),
                      child: Text(s.clearDates),
                    ),
                  ),
              ],
            ),
          ),
        ),
        const SizedBox(height: Tokens.sp2),
      ],
      item: (context, q, _) => Card(
        key: Key('query-${q['id']}'),
        child: InkWell(
          onTap: () => openQuery(context, widget.profile, '${q['id']}'),
          child: Padding(
            padding: const EdgeInsets.all(Tokens.sp4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${q['subject'] ?? ''}', style: const TextStyle(fontWeight: Tokens.fwBold)),
                Text(
                  [
                    '${q['number'] ?? ''}',
                    s.qryKind('${q['kind']}'),
                    if (q['categoryName'] != null) '${q['categoryName']}',
                    if (q['studentName'] != null) '${q['studentName']}',
                    if (q['openedAt'] != null) s.date('${q['openedAt']}'.split('T').first),
                  ].join(' · '),
                  style: TextStyle(color: muted, fontSize: 13),
                ),
                const SizedBox(height: Tokens.sp1),
                Wrap(
                  spacing: Tokens.sp1,
                  runSpacing: Tokens.sp1,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    StatusChip(s.qryStatus('${q['status']}'), queryStatusTone('${q['status']}')),
                    if (q['decision'] != null)
                      StatusChip(
                        s.qryDecision('${q['decision']}'),
                        q['decision'] == 'approved' ? Tone.success : Tone.danger,
                      ),
                    if (q['rating'] != null)
                      Semantics(
                        label: s.qryYouRated((q['rating'] as num).toInt()),
                        excludeSemantics: true,
                        child: Text(
                          '★' * (q['rating'] as num).toInt(),
                          style: const TextStyle(color: Tokens.statusWarning),
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
      footer: [
        SectionTitle(s.qryFeedback),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(Tokens.sp4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                DropdownMenu<String>(
                  key: const Key('qryArea'),
                  label: Text(s.qryArea),
                  initialSelection: _area,
                  trailingIcon: dropArrow(s.qryArea),
                  selectedTrailingIcon: dropArrow(s.qryArea, open: true),
                  expandedInsets: EdgeInsets.zero,
                  enableFilter: true,
                  enableSearch: true,
                  requestFocusOnTap: true,
                  onSelected: (v) => setState(() => _area = v ?? 'teaching'),
                  dropdownMenuEntries: [
                    for (final a in const [
                      'teaching',
                      'transport',
                      'fees',
                      'facilities',
                      'communication',
                      'app',
                    ])
                      DropdownMenuEntry(value: a, label: s.qryAreaName(a)),
                  ],
                ),
                const SizedBox(height: Tokens.sp2),
                Text(s.qryRating, style: TextStyle(color: muted, fontSize: 13)),
                QueryStars(
                  value: _rating,
                  onChanged: (n) => setState(() => _rating = n),
                  s: s,
                  name: 'qryFbStar',
                ),
                TextField(
                  key: const Key('qryFbComment'),
                  controller: _comment,
                  maxLength: 1000,
                  decoration: InputDecoration(
                    labelText: s.qryComment,
                    border: const OutlineInputBorder(),
                    counterText: '',
                  ),
                ),
                if (_error != null) ...[const SizedBox(height: Tokens.sp2), ErrorText(_error!)],
                const SizedBox(height: Tokens.sp3),
                OutlinedButton(
                  key: const Key('qryFbSend'),
                  onPressed: _busy ? null : _feedback,
                  child: Text(s.qrySendFeedback),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Files to send with a query, a reply or a reopening: PDFs or photos, up to five of 5 MB each.
class QueryFilesField extends ConsumerWidget {
  const QueryFilesField({
    super.key,
    required this.files,
    required this.onChanged,
    required this.name,
  });
  final List<PickedFile> files;
  final ValueChanged<List<PickedFile>> onChanged;
  final String name;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(s.qryFiles, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
        Text(s.qryFilesHelp, style: TextStyle(color: muted, fontSize: 13)),
        const SizedBox(height: Tokens.sp2),
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            for (var i = 0; i < files.length; i++)
              InputChip(
                key: Key('$name-file-$i'),
                avatar: const Icon(Icons.attach_file, size: 18),
                label: Text(files[i].name),
                deleteButtonTooltipMessage: s.qryRemoveFile(files[i].name),
                onDeleted: () => onChanged([...files]..removeAt(i)),
              ),
            if (files.length < 5)
              OutlinedButton.icon(
                key: Key('$name-addFile'),
                icon: const Icon(Icons.upload_file),
                label: Text(s.qryAddFile),
                onPressed: () async {
                  final picked = await ref.read(leaveFilePickerProvider)();
                  final ok = picked
                      .where(
                        (f) =>
                            RegExp(r'^(application/pdf|image/(png|jpeg|webp))$')
                                .hasMatch(f.contentType) &&
                            f.bytes.length <= 5 * 1024 * 1024,
                      )
                      .toList();
                  if (ok.length < picked.length && context.mounted) {
                    ScaffoldMessenger.of(context)
                        .showSnackBar(SnackBar(content: Text(s.qryFileWrong)));
                  }
                  onChanged([...files, ...ok].take(5).toList());
                },
              ),
          ],
        ),
      ],
    );
  }
}

/// Uploads the files and gives their ids.
Future<List<String>> uploadQueryFiles(WidgetRef ref, List<PickedFile> files) async => [
  for (final f in files) await uploadFile(ref.read(apiProvider), ref.read(transportProvider), f),
];

/// A new query or complaint as on the website: which (query or complaint), about what, the subject, the details
/// and files. Pops with the new query's id. (Leave is applied for under Attendance.)
class QueryForm extends ConsumerStatefulWidget {
  const QueryForm({super.key, required this.profile, this.kind = 'query'});
  final Profile profile;
  final String kind;

  @override
  ConsumerState<QueryForm> createState() => _QueryFormState();
}

class _QueryFormState extends ConsumerState<QueryForm> {
  late String _kind = widget.kind == 'complaint' ? 'complaint' : 'query';
  String _category = 'other';
  final _subject = TextEditingController();
  final _body = TextEditingController();
  List<PickedFile> _files = [];
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final s = ref.read(stringsProvider);
    if (_subject.text.trim().length < 3) return setState(() => _error = s.qryNeedSubject);
    if (_body.text.trim().isEmpty) return setState(() => _error = s.qryNeedDetails);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final ids = await uploadQueryFiles(ref, _files);
      final r = asJson(
        await ref
            .read(apiProvider)
            .engagementCreate(
              body: CreateQueryDto(
                studentId: widget.profile.studentId ?? '',
                kind: _kind,
                categoryCode: _category,
                subject: _subject.text.trim(),
                body: _body.text.trim(),
                fileIds: ids,
              ),
            ),
      );
      if (mounted) Navigator.of(context).pop('${r['id']}');
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
    final categories = ref.watch(_categoriesProvider).value ?? const <Json>[];
    return ListView(
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        Text(s.qryNewHelp, style: TextStyle(color: muted, fontSize: 14)),
        const SizedBox(height: Tokens.sp3),
        Semantics(
          label: s.qryTypeLabel,
          container: true,
          explicitChildNodes: true,
          child: Wrap(
            spacing: Tokens.sp2,
            children: [
              for (final k in const ['query', 'complaint'])
                ChoiceChip(
                  key: Key('qryFormKind-$k'),
                  label: Text(s.qryKind(k)),
                  selected: _kind == k,
                  showCheckmark: false,
                  onSelected: (_) => setState(() => _kind = k),
                ),
            ],
          ),
        ),
        const SizedBox(height: Tokens.sp3),
        if (categories.isNotEmpty) ...[
          DropdownMenu<String>(
            key: const Key('qryCategory'),
            label: Text(s.qryAbout),
            initialSelection: categories.any((c) => c['code'] == _category) ? _category : null,
            trailingIcon: dropArrow(s.qryAbout),
            selectedTrailingIcon: dropArrow(s.qryAbout, open: true),
            expandedInsets: EdgeInsets.zero,
            enableFilter: true,
            enableSearch: true,
            requestFocusOnTap: true,
            onSelected: (v) => setState(() => _category = v ?? 'other'),
            dropdownMenuEntries: [
              for (final c in categories)
                DropdownMenuEntry(value: '${c['code']}', label: '${c['name']}'),
            ],
          ),
          const SizedBox(height: Tokens.sp3),
        ],
        TextField(
          key: const Key('qrySubject'),
          controller: _subject,
          maxLength: 160,
          decoration: InputDecoration(labelText: s.qrySubject, border: const OutlineInputBorder()),
        ),
        const SizedBox(height: Tokens.sp2),
        TextField(
          key: const Key('qryBody'),
          controller: _body,
          maxLines: 5,
          maxLength: 4000,
          decoration: InputDecoration(labelText: s.qryDetails, border: const OutlineInputBorder()),
        ),
        const SizedBox(height: Tokens.sp2),
        QueryFilesField(
          files: _files,
          onChanged: (f) => setState(() => _files = f),
          name: 'qryNew',
        ),
        if (_error != null) ...[const SizedBox(height: Tokens.sp3), ErrorText(_error!)],
        const SizedBox(height: Tokens.sp4),
        FilledButton(
          key: const Key('qrySend'),
          onPressed: _busy ? null : _send,
          child: Text(s.qrySend),
        ),
      ],
    );
  }
}

/// A query in full as on the website: about what, the subject, the child, when it was opened and who handles it;
/// its status (and the leave decision); what was written with the files; the school's answers and yours; Reply while
/// it is open; the resolution; Reopen within the school's window; and the rating.
class QueryDetail extends ConsumerStatefulWidget {
  const QueryDetail({super.key, required this.profile, required this.id, this.saved = false});
  final Profile profile;
  final String id;
  final bool saved;

  @override
  ConsumerState<QueryDetail> createState() => _QueryDetailState();
}

class _QueryDetailState extends ConsumerState<QueryDetail> {
  final _reply = TextEditingController();
  final _reason = TextEditingController();
  final _comment = TextEditingController();
  List<PickedFile> _replyFiles = [];
  List<PickedFile> _reopenFiles = [];
  int _rating = 0;
  late bool _saved = widget.saved;
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _reply.dispose();
    _reason.dispose();
    _comment.dispose();
    super.dispose();
  }

  Future<void> _do(Future<void> Function() f) async {
    final s = ref.read(stringsProvider);
    setState(() {
      _busy = true;
      _error = null;
      _saved = false;
    });
    try {
      await f();
      ref.invalidate(queryProvider(widget.id));
      ref.read(feedRoundProvider('family-queries').notifier).bump();
      if (mounted) {
        setState(() {
          _busy = false;
          _saved = true;
          _reply.clear();
          _reason.clear();
          _comment.clear();
          _replyFiles = [];
          _reopenFiles = [];
        });
      }
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
    final api = ref.read(apiProvider);
    return AsyncBody<(Json, Json?)>(
      value: ref.watch(queryProvider(widget.id)),
      retry: () => ref.invalidate(queryProvider(widget.id)),
      data: (both) {
        final (q, hd) = both;
        final status = '${q['status']}';
        final you = asJson(hd?['you']);
        final rated = q['rating'] != null;
        Widget files(List ids, String who) => ids.isEmpty
            ? const SizedBox.shrink()
            : Padding(
                padding: const EdgeInsets.only(top: Tokens.sp2),
                child: Wrap(
                  spacing: Tokens.sp1,
                  children: [
                    for (final (i, f) in ids.indexed)
                      FileIcons(
                        name: 'qf-$f',
                        label: s.qryAttachment(i + 1, who),
                        load: () => api.engagementMyFile(id: widget.id, fileId: '$f'),
                      ),
                  ],
                ),
              );
        return ListView(
          padding: const EdgeInsets.all(Tokens.sp4),
          children: [
            Text(
              [q['number'], q['categoryName']].where((x) => x != null).join(' · '),
              style: TextStyle(color: muted, fontSize: 14),
            ),
            Text(
              '${q['subject'] ?? ''}',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: Tokens.fwBold),
            ),
            Text(
              [
                s.qryOpened(
                  '${q['studentName'] ?? ''}',
                  s.date('${q['openedAt'] ?? ''}'.split('T').first),
                ),
                if (q['assignedTo'] != null) s.qryHandledBy('${q['assignedTo']}'),
              ].join(' · '),
              style: TextStyle(color: muted, fontSize: 13),
            ),
            const SizedBox(height: Tokens.sp2),
            Wrap(
              spacing: Tokens.sp1,
              children: [
                StatusChip(s.qryStatus(status), queryStatusTone(status)),
                if (q['decision'] != null)
                  StatusChip(
                    s.qryDecision('${q['decision']}'),
                    q['decision'] == 'approved' ? Tone.success : Tone.danger,
                  ),
              ],
            ),
            if (_saved) ...[
              const SizedBox(height: Tokens.sp3),
              Notice(key: const Key('qrySaved'), text: s.qrySaved),
            ],
            if (_error != null) ...[const SizedBox(height: Tokens.sp3), ErrorText(_error!)],
            const SizedBox(height: Tokens.sp3),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(Tokens.sp4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SelectionArea(child: Text('${q['body'] ?? ''}')),
                    files(q['fileIds'] as List? ?? const [], s.qryYou),
                    if (q['kind'] == 'leave')
                      Padding(
                        padding: const EdgeInsets.only(top: Tokens.sp2),
                        child: Text(
                          s.qryLeave(s.date(q['leaveFrom'] ?? ''), s.date(q['leaveTo'] ?? '')),
                          style: TextStyle(color: muted, fontSize: 13),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            for (final r in asList(q['responses']))
              Padding(
                // the school's answers on the left, yours set in
                padding: EdgeInsetsDirectional.only(
                  start: r['authorKind'] == 'staff' ? 0 : Tokens.sp5,
                ),
                child: Card(
                  key: Key('response-${r['id']}'),
                  child: Padding(
                    padding: const EdgeInsets.all(Tokens.sp4),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          [
                            r['authorKind'] == 'staff' ? '${r['author'] ?? s.qrySchool}' : s.qryYou,
                            if (DateTime.tryParse('${r['createdAt']}') != null)
                              s.dateTime(DateTime.parse('${r['createdAt']}')),
                          ].join(' · '),
                          style: TextStyle(color: muted, fontSize: 13),
                        ),
                        SelectionArea(child: Text('${r['body'] ?? ''}')),
                        files(
                          r['fileIds'] as List? ?? const [],
                          r['authorKind'] == 'staff' ? '${r['author'] ?? s.qrySchool}' : s.qryYou,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            if (status != 'closed') ...[
              SectionTitle(s.qryReply),
              TextField(
                key: const Key('qryReplyText'),
                controller: _reply,
                maxLines: 3,
                maxLength: 4000,
                decoration: InputDecoration(
                  labelText: s.qryReply,
                  border: const OutlineInputBorder(),
                ),
              ),
              QueryFilesField(
                files: _replyFiles,
                onChanged: (f) => setState(() => _replyFiles = f),
                name: 'qryReply',
              ),
              const SizedBox(height: Tokens.sp2),
              FilledButton(
                key: const Key('qryReplySend'),
                onPressed: _busy
                    ? null
                    : () {
                        if (_reply.text.trim().isEmpty) {
                          return setState(() => _error = s.qryNeedDetails);
                        }
                        _do(() async {
                          await api.engagementReply(
                            id: widget.id,
                            body: RespondDto(
                              body: _reply.text.trim(),
                              fileIds: await uploadQueryFiles(ref, _replyFiles),
                            ),
                          );
                        });
                      },
                child: Text(s.qrySend),
              ),
            ],
            if (hd?['resolution'] != null && status == 'closed') ...[
              const SizedBox(height: Tokens.sp3),
              Notice(
                key: const Key('qryResolution'),
                text: '${s.qryResolution}: ${hd!['resolution']}',
              ),
            ],
            if (you['canReopen'] == true) ...[
              SectionTitle(s.qryNotResolved),
              TextField(
                key: const Key('qryReopenReason'),
                controller: _reason,
                maxLines: 3,
                maxLength: 2000,
                decoration: InputDecoration(
                  labelText: s.qryWhyReopen,
                  border: const OutlineInputBorder(),
                ),
              ),
              QueryFilesField(
                files: _reopenFiles,
                onChanged: (f) => setState(() => _reopenFiles = f),
                name: 'qryReopen',
              ),
              if (you['reopenUntil'] != null)
                Text(
                  s.qryReopenUntil(s.date('${you['reopenUntil']}'.split('T').first)),
                  style: TextStyle(color: muted, fontSize: 13),
                ),
              const SizedBox(height: Tokens.sp2),
              OutlinedButton(
                key: const Key('qryReopen'),
                onPressed: _busy
                    ? null
                    : () {
                        if (_reason.text.trim().length < 3) {
                          return setState(() => _error = s.qryNeedReason);
                        }
                        _do(() async {
                          await api.engagementReopen(
                            id: widget.id,
                            body: ReopenTicketDto(
                              reason: _reason.text.trim(),
                              fileIds: await uploadQueryFiles(ref, _reopenFiles),
                            ),
                          );
                        });
                      },
                child: Text(s.qryReopen),
              ),
            ],
            if ((status == 'answered' || status == 'closed') && !rated) ...[
              SectionTitle(s.qryHowHandled),
              QueryStars(
                value: _rating,
                onChanged: (n) => setState(() => _rating = n),
                s: s,
                name: 'qryRateStar',
              ),
              TextField(
                key: const Key('qryRateComment'),
                controller: _comment,
                maxLength: 500,
                decoration: InputDecoration(
                  labelText: s.qryComment,
                  border: const OutlineInputBorder(),
                  counterText: '',
                ),
              ),
              const SizedBox(height: Tokens.sp2),
              OutlinedButton(
                key: const Key('qryRate'),
                onPressed: _busy
                    ? null
                    : () {
                        if (_rating == 0) return setState(() => _error = s.qryChooseRating);
                        _do(
                          () => api.engagementRate(
                            id: widget.id,
                            body: RateDto(
                              rating: _rating,
                              comment: _comment.text.trim().isEmpty ? null : _comment.text.trim(),
                            ),
                          ),
                        );
                      },
                child: Text(s.qryRate),
              ),
            ] else if (rated) ...[
              const SizedBox(height: Tokens.sp3),
              Text(
                [
                  s.qryYouRated((q['rating'] as num).toInt()),
                  if (q['ratingComment'] != null) '${q['ratingComment']}',
                ].join(' · '),
                key: const Key('qryRated'),
                style: TextStyle(color: muted, fontSize: 14),
              ),
            ],
          ],
        );
      },
    );
  }
}
