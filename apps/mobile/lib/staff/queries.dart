import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart' show ApiException;
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../family/queries.dart'
    show QueryFilesField, QueryStars, QueryWords, queryStatusTone, uploadQueryFiles;
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'data.dart';

/// The words of Queries and helpdesk (as the staff website's, in English and Hindi).
extension StaffQueryWords on S {
  String _sq(String en, String hi) => hindi ? hi : en;

  String get sqAnswerTab => _sq('To answer', 'उत्तर देने हेतु');
  String get sqMineTab => _sq('My requests', 'मेरे अनुरोध');
  String get sqShowClosed => _sq('Show closed', 'बंद दिखाएँ');
  String get sqRaiseStaff => _sq('Raise a staff query', 'स्टाफ़ प्रश्न भेजें');
  String get sqRaiseProvider => _sq('Ticket to ERP provider', 'ERP प्रदाता को टिकट');
  String get sqNoneAnswer => _sq('Nothing waiting for you.', 'आपके लिए कुछ प्रतीक्षा में नहीं।');
  String get sqNoneMine =>
      _sq('You have not raised anything yet.', 'आपने अभी तक कुछ नहीं भेजा है।');
  String get sqNotYours => _sq(
    'Answering queries is not part of your role.',
    'प्रश्नों का उत्तर देना आपकी भूमिका में नहीं है।',
  );
  String sqDesk(String desk) => switch (desk) {
    'parent' => _sq('Family query', 'परिवार का प्रश्न'),
    'provider' => _sq('ERP ticket', 'ERP टिकट'),
    'hostel' => _sq('Hostel complaint', 'छात्रावास शिकायत'),
    _ => _sq('Staff query', 'स्टाफ़ प्रश्न'),
  };
  String sqLevel(Object n) => _sq('Level $n', 'स्तर $n');
  String get sqPastDue => _sq('Past due', 'समय सीमा पार');
  String sqWith(String who) => _sq('with $who', '$who के पास');
  String sqRaisedBy(String who, String when) =>
      _sq('Raised by $who · $when', '$who द्वारा भेजा गया · $when');
  String get sqProviderTitle => _sq('Ticket to the ERP provider', 'ERP प्रदाता को टिकट');
  String get sqProviderHelp => _sq(
    'Something not working in EduPro? The provider replies here.',
    'EduPro में कुछ काम नहीं कर रहा? प्रदाता यहीं उत्तर देगा।',
  );
  String get sqStaffHelp => _sq(
    'It goes to the person who handles this type of query.',
    'यह उस व्यक्ति को जाएगा जो इस प्रकार के प्रश्न देखता है।',
  );
  String get sqType => _sq('Query type', 'प्रश्न का प्रकार');
  String get sqChooseType => _sq('Choose the query type.', 'प्रश्न का प्रकार चुनें।');
  String get sqUrgency => _sq('How urgent', 'कितना ज़रूरी');
  String sqPriority(String p) => switch (p) {
    'urgent' => _sq('Urgent: work has stopped', 'अति आवश्यक: काम रुक गया है'),
    'high' => _sq('High', 'उच्च'),
    'low' => _sq('Low', 'निम्न'),
    _ => _sq('Normal', 'सामान्य'),
  };
  String get sqProvider => _sq('ERP provider', 'ERP प्रदाता');
  String get sqInternal => _sq(
    'Internal note (not shown to the person who raised it)',
    'आंतरिक टिप्पणी (भेजने वाले को नहीं दिखेगी)',
  );
  String get sqInternalTag => _sq('Internal note', 'आंतरिक टिप्पणी');
  String sqOnlyThey(String who) => _sq(
    'This query is with $who. Only they can answer and close it.',
    'यह प्रश्न $who के पास है। केवल वही इसका उत्तर देकर बंद कर सकते हैं।',
  );
  String get sqResolveClose => _sq('Resolve and close', 'हल करें और बंद करें');
  String get sqHowResolved => _sq(
    'How it was resolved (sent to the person who raised it)',
    'यह कैसे हल हुआ (भेजने वाले को भेजा जाएगा)',
  );
  String get sqNeedResolution => _sq(
    'Write how it was resolved (at least 3 letters).',
    'लिखें कि यह कैसे हल हुआ (कम से कम 3 अक्षर)।',
  );
  String get sqCloseResolved => _sq('Close as resolved', 'हल मानकर बंद करें');
  String get sqHandOver => _sq('Cannot resolve it? Hand it over', 'हल नहीं कर सकते? आगे सौंपें');
  String get sqTo => _sq('To an employee or a role', 'किसी कर्मचारी या भूमिका को');
  String sqRole(String name, String? people) =>
      '${_sq('Role', 'भूमिका')}: $name${people != null && people.isNotEmpty ? ' ($people)' : ''}';
  String get sqNoteThem => _sq('Note for them (internal)', 'उनके लिए टिप्पणी (आंतरिक)');
  String get sqHandOverBtn => _sq('Hand over', 'सौंपें');
  String get sqChooseWho => _sq('Choose whom to hand it to.', 'चुनें कि किसे सौंपना है।');
  String get sqTimeline => _sq('Timeline', 'समयरेखा');
  String sqEvent(String kind) => switch (kind) {
    'created' => _sq('Raised, sent to', 'भेजा गया, प्राप्तकर्ता'),
    'assigned' => _sq('Handed to', 'सौंपा गया'),
    'replied' => _sq('Reply', 'उत्तर'),
    'note' => _sq('Internal note', 'आंतरिक टिप्पणी'),
    'escalated' => _sq('Escalated to', 'आगे बढ़ाया गया'),
    'breached' => _sq('Time limit missed', 'समय सीमा चूकी'),
    'closed' => _sq('Closed', 'बंद'),
    'reopened' => _sq('Reopened', 'फिर से खोला'),
    'rated' => _sq('Rated', 'रेटिंग दी'),
    _ => kind,
  };
}

/// A list of tickets: `(profile, view, closed)` — view `answer` (handed to me, not raised by me) or `mine`.
final staffTicketsProvider = FutureProvider.autoDispose
    .family<Loaded<Json>, (Profile, String, bool)>((ref, k) async {
      final (p, view, closed) = k;
      final api = ref.read(apiProvider);
      final r = await cached('staff-tickets:${p.id}:$view:$closed', () async {
        final list = asJson(
          await api.helpdeskList(
            size: 100,
            view: view == 'mine' ? 'mine' : 'all',
            status: closed ? 'closed' : 'active',
          ),
        );
        if (view == 'mine') return list;
        // as on the staff website: what I raised myself is under My requests, not To answer
        final me = '${asJson(asJson(await api.meMe())['user'])['id'] ?? ''}';
        return {
          ...list,
          'data': [
            for (final t in asList(list['data']))
              if ('${t['raisedByUserId']}' != me) t,
          ],
        };
      });
      return Loaded(asJson(r.data), r.at, stale: r.stale);
    });

final staffTicketProvider = FutureProvider.autoDispose.family<Json, String>(
  (ref, id) async => asJson(await ref.read(apiProvider).helpdeskGet(id: id)),
);

final _headsProvider = FutureProvider.autoDispose.family<List<Json>, String>(
  (ref, desk) async =>
      asList(asJson(await ref.read(apiProvider).helpdeskHeads(desk: desk))['data']),
);

final _assigneesProvider = FutureProvider.autoDispose<Json>((ref) async {
  try {
    return asJson(await ref.read(apiProvider).helpdeskAssignees());
  } catch (_) {
    return const {'staff': <Object>[], 'roles': <Object>[]};
  }
});

String _when(S s, Object? v) {
  final d = DateTime.tryParse('$v');
  return d == null ? '' : s.dateTime(d);
}

String _who(Json t) => '${t['assignedTo'] ?? t['assignedRoleName'] ?? '—'}';

/// Queries and helpdesk as on the staff website: queries to answer (the families of my sections and anything
/// handed to me) and my own staff queries and tickets to the ERP provider — each in full on its own screen, with
/// replies, files, handing over, closing, reopening and rating. No web page. Student leave is decided under Student
/// leave (families apply for it under Attendance), not here.
class StaffQueriesScreen extends ConsumerStatefulWidget {
  const StaffQueriesScreen({super.key, required this.profile, this.initialTab = 0});
  final Profile profile;
  final int initialTab;

  @override
  ConsumerState<StaffQueriesScreen> createState() => _StaffQueriesScreenState();
}

class _StaffQueriesScreenState extends ConsumerState<StaffQueriesScreen> {
  bool _closed = false;

  Future<void> _raise(String desk) async {
    final s = ref.read(stringsProvider);
    final id = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => FamilyPage(
          title: desk == 'provider' ? s.sqProviderTitle : s.sqRaiseStaff,
          child: StaffRaiseForm(desk: desk),
        ),
      ),
    );
    if (!mounted) return;
    ref.invalidate(staffTicketsProvider);
    if (id != null) {
      pushPage(context, s.qryDetails, StaffTicketDetail(id: id, saved: true));
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    Widget head() => Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            OutlinedButton.icon(
              key: const Key('sqRaiseStaff'),
              icon: const Icon(Icons.add_comment_outlined),
              label: Text(s.sqRaiseStaff),
              onPressed: () => _raise('staff'),
            ),
            OutlinedButton.icon(
              key: const Key('sqRaiseProvider'),
              icon: const Icon(Icons.support_agent),
              label: Text(s.sqRaiseProvider),
              onPressed: () => _raise('provider'),
            ),
            FilterChip(
              key: const Key('sqClosed'),
              label: Text(s.sqShowClosed),
              selected: _closed,
              onSelected: (v) => setState(() => _closed = v),
            ),
          ],
        ),
        const SizedBox(height: Tokens.sp3),
      ],
    );
    return DefaultTabController(
      length: 2,
      initialIndex: widget.initialTab.clamp(0, 1),
      child: Column(
        children: [
          Material(
            color: Theme.of(context).colorScheme.surface,
            child: TabBar(
              key: const Key('sqTabs'),
              isScrollable: true,
              tabAlignment: TabAlignment.start,
              tabs: [
                Tab(text: s.sqAnswerTab),
                Tab(text: s.sqMineTab),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              children: [
                _Tickets(profile: widget.profile, view: 'answer', closed: _closed, head: head),
                _Tickets(profile: widget.profile, view: 'mine', closed: _closed, head: head),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Tickets extends ConsumerWidget {
  const _Tickets({
    required this.profile,
    required this.view,
    required this.closed,
    required this.head,
  });
  final Profile profile;
  final String view;
  final bool closed;
  final Widget Function() head;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final key = (profile, view, closed);
    final value = ref.watch(staffTicketsProvider(key));
    if (value.error is ApiException && (value.error as ApiException).status == 403) {
      return ListView(
        padding: const EdgeInsets.all(Tokens.sp4),
        children: [
          head(),
          Notice(text: s.sqNotYours),
        ],
      );
    }
    return LoadedList<Json>(
      value: value,
      refresh: () => ref.refresh(staffTicketsProvider(key).future),
      children: (d) {
        final rows = asList(d['data']);
        return [
          head(),
          if (rows.isEmpty) Notice(text: view == 'mine' ? s.sqNoneMine : s.sqNoneAnswer),
          for (final t in rows) _TicketCard(ticket: t, mine: view == 'mine'),
        ];
      },
    );
  }
}

class _TicketCard extends ConsumerWidget {
  const _TicketCard({required this.ticket, required this.mine});
  final Json ticket;
  final bool mine;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final t = ticket;
    final id = '${t['id']}';
    final status = '${t['status']}';
    final level = (t['level'] as num?)?.toInt() ?? 1;
    return Card(
      key: Key('sqTicket-$id'),
      margin: const EdgeInsets.only(bottom: Tokens.sp2),
      child: InkWell(
        onTap: () => pushPage(context, '${t['number']}', StaffTicketDetail(id: id)),
        child: Padding(
          padding: const EdgeInsets.all(Tokens.sp3),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${t['subject']}', style: const TextStyle(fontWeight: Tokens.fwSemibold)),
              Text(
                [
                  t['number'],
                  s.sqDesk('${t['desk']}'),
                  t['head'],
                  if (t['studentName'] != null)
                    '${t['studentName']}${t['section'] != null ? ' (${t['section']})' : ''}',
                  if (!mine && t['raisedBy'] != null) t['raisedBy'],
                  if (mine) s.sqWith(_who(t)),
                ].where((x) => x != null).join(' · '),
                style: TextStyle(color: muted, fontSize: 13),
              ),
              const SizedBox(height: Tokens.sp1),
              Wrap(
                spacing: Tokens.sp1,
                runSpacing: Tokens.sp1,
                children: [
                  if (level > 1) StatusChip(s.sqLevel(level), Tone.danger),
                  if (t['overdue'] == true) StatusChip(s.sqPastDue, Tone.danger),
                  StatusChip(s.qryStatus(status), queryStatusTone(status)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Raise a staff query (salary, HR, IT …) or a ticket to the ERP provider, as on the staff website: the query
/// type, how urgent (the provider), the subject, the details and files. Pops with the new ticket's id.
class StaffRaiseForm extends ConsumerStatefulWidget {
  const StaffRaiseForm({super.key, required this.desk});
  final String desk;

  @override
  ConsumerState<StaffRaiseForm> createState() => _StaffRaiseFormState();
}

class _StaffRaiseFormState extends ConsumerState<StaffRaiseForm> {
  String? _head;
  String _priority = 'normal';
  final _subject = TextEditingController();
  final _body = TextEditingController();
  List<PickedFile> _files = [];
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final s = ref.read(stringsProvider);
    if (_head == null) return setState(() => _error = s.sqChooseType);
    if (_subject.text.trim().length < 3) return setState(() => _error = s.qryNeedSubject);
    if (_body.text.trim().length < 3) return setState(() => _error = s.qryNeedDetails);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = asJson(
        await ref
            .read(apiProvider)
            .helpdeskCreate(
              body: CreateTicketDto(
                desk: widget.desk == 'provider' ? 'provider' : 'staff',
                categoryCode: _head!,
                subject: _subject.text.trim(),
                body: _body.text.trim(),
                priority: widget.desk == 'provider' ? _priority : 'normal',
                fileIds: await uploadQueryFiles(ref, _files),
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
    final provider = widget.desk == 'provider';
    return AsyncBody<List<Json>>(
      value: ref.watch(_headsProvider(widget.desk)),
      retry: () => ref.invalidate(_headsProvider(widget.desk)),
      data: (heads) => ListView(
        key: const Key('sqRaiseForm'),
        padding: const EdgeInsets.all(Tokens.sp4),
        children: [
          Text(provider ? s.sqProviderHelp : s.sqStaffHelp),
          const SizedBox(height: Tokens.sp3),
          DropdownMenu<String>(
            key: const Key('sqHead'),
            label: Text(s.sqType),
            trailingIcon: dropArrow(s.sqType),
            selectedTrailingIcon: dropArrow(s.sqType, open: true),
            expandedInsets: EdgeInsets.zero,
            enableFilter: true,
            enableSearch: true,
            requestFocusOnTap: true,
            initialSelection: _head,
            onSelected: (v) => setState(() => _head = v),
            dropdownMenuEntries: [
              for (final h in heads)
                DropdownMenuEntry(value: '${h['code']}', label: '${h['name']}'),
            ],
          ),
          if (provider) ...[
            const SizedBox(height: Tokens.sp3),
            DropdownMenu<String>(
              key: const Key('sqPriority'),
              label: Text(s.sqUrgency),
              trailingIcon: dropArrow(s.sqUrgency),
              selectedTrailingIcon: dropArrow(s.sqUrgency, open: true),
              expandedInsets: EdgeInsets.zero,
              enableFilter: true,
              enableSearch: true,
              requestFocusOnTap: true,
              initialSelection: _priority,
              onSelected: (v) => setState(() => _priority = v ?? 'normal'),
              dropdownMenuEntries: [
                for (final p in const ['urgent', 'high', 'normal', 'low'])
                  DropdownMenuEntry(value: p, label: s.sqPriority(p)),
              ],
            ),
          ],
          const SizedBox(height: Tokens.sp3),
          TextField(
            key: const Key('sqSubject'),
            controller: _subject,
            maxLength: 200,
            decoration: InputDecoration(
              labelText: s.qrySubject,
              border: const OutlineInputBorder(),
              counterText: '',
            ),
          ),
          const SizedBox(height: Tokens.sp3),
          TextField(
            key: const Key('sqBody'),
            controller: _body,
            maxLines: 5,
            maxLength: 5000,
            decoration: InputDecoration(
              labelText: s.qryDetails,
              border: const OutlineInputBorder(),
            ),
          ),
          QueryFilesField(
            files: _files,
            onChanged: (f) => setState(() => _files = f),
            name: 'sqRaise',
          ),
          if (_error != null) ...[const SizedBox(height: Tokens.sp2), ErrorText(_error!)],
          const SizedBox(height: Tokens.sp3),
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton(
              key: const Key('sqSend'),
              onPressed: _busy ? null : _send,
              child: Text(s.qrySend),
            ),
          ),
        ],
      ),
    );
  }
}

/// One ticket in full as on the staff website: what was raised and its files, the replies (internal notes
/// marked), the resolution; and by the person's part in it — reply (with files, an internal note for the
/// handler), resolve and close, hand over to an employee or a role, reopen, rate — and the timeline.
class StaffTicketDetail extends ConsumerStatefulWidget {
  const StaffTicketDetail({super.key, required this.id, this.saved = false});
  final String id;
  final bool saved;

  @override
  ConsumerState<StaffTicketDetail> createState() => _StaffTicketDetailState();
}

class _StaffTicketDetailState extends ConsumerState<StaffTicketDetail> {
  final _reply = TextEditingController();
  final _resolution = TextEditingController();
  final _note = TextEditingController();
  final _reason = TextEditingController();
  List<PickedFile> _replyFiles = [];
  List<PickedFile> _closeFiles = [];
  List<PickedFile> _reopenFiles = [];
  bool _internal = false;
  String? _to;
  int _rating = 0;
  late bool _saved = widget.saved;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_reply, _resolution, _note, _reason]) {
      c.dispose();
    }
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
      ref.invalidate(staffTicketProvider(widget.id));
      ref.invalidate(staffTicketsProvider);
      // the header's Approvals lists the queries with me: read it again
      ref.invalidate(approvalsProvider);
      if (mounted) {
        setState(() {
          _busy = false;
          _saved = true;
          for (final c in [_reply, _resolution, _note, _reason]) {
            c.clear();
          }
          _replyFiles = [];
          _closeFiles = [];
          _reopenFiles = [];
          _internal = false;
          _to = null;
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
    return AsyncBody<Json>(
      value: ref.watch(staffTicketProvider(widget.id)),
      retry: () => ref.invalidate(staffTicketProvider(widget.id)),
      data: (q) {
        final status = '${q['status']}';
        final you = asJson(q['you']);
        final level = (q['level'] as num?)?.toInt() ?? 1;
        Widget files(List ids, String who) => ids.isEmpty
            ? const SizedBox.shrink()
            : Padding(
                padding: const EdgeInsets.only(top: Tokens.sp2),
                child: Wrap(
                  spacing: Tokens.sp1,
                  children: [
                    for (final (i, f) in ids.indexed)
                      FileIcons(
                        name: 'sqf-$f',
                        label: s.qryAttachment(i + 1, who),
                        load: () => api.helpdeskFile(id: widget.id, fileId: '$f'),
                      ),
                  ],
                ),
              );
        InputDecoration box(String label) =>
            InputDecoration(labelText: label, border: const OutlineInputBorder());
        return ListView(
          key: const Key('sqTicketDetail'),
          padding: const EdgeInsets.all(Tokens.sp4),
          children: [
            Text(
              [q['number'], q['head']].where((x) => x != null).join(' · '),
              style: TextStyle(color: muted, fontSize: 14),
            ),
            Text(
              '${q['subject'] ?? ''}',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: Tokens.fwBold),
            ),
            Text(
              [
                if (q['studentName'] != null)
                  '${q['studentName']}${q['section'] != null ? ' (${q['section']})' : ''}${q['admissionNo'] != null ? ' · ${q['admissionNo']}' : ''}',
                s.sqRaisedBy('${q['raisedBy'] ?? ''}', _when(s, q['openedAt'])),
                '${s.sqWith(_who(q))}${level > 1 ? ' (${s.sqLevel(level)})' : ''}',
              ].join(' · '),
              style: TextStyle(color: muted, fontSize: 13),
            ),
            const SizedBox(height: Tokens.sp2),
            Wrap(
              spacing: Tokens.sp1,
              runSpacing: Tokens.sp1,
              children: [
                if (q['overdue'] == true) StatusChip(s.sqPastDue, Tone.danger),
                StatusChip(s.qryStatus(status), queryStatusTone(status)),
              ],
            ),
            if (_saved) ...[
              const SizedBox(height: Tokens.sp3),
              Notice(key: const Key('sqSaved'), text: s.qrySaved),
            ],
            if (_error != null) ...[const SizedBox(height: Tokens.sp3), ErrorText(_error!)],
            const SizedBox(height: Tokens.sp3),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(Tokens.sp4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(
                      '${q['raisedBy'] ?? ''} · ${_when(s, q['openedAt'])}',
                      style: TextStyle(color: muted, fontSize: 13),
                    ),
                    SelectionArea(child: Text('${q['body'] ?? ''}')),
                    files(q['fileIds'] as List? ?? const [], '${q['raisedBy'] ?? ''}'),
                  ],
                ),
              ),
            ),
            for (final r in asList(q['replies']))
              Padding(
                // the person who raised it on the left, the answers set in (as on the website)
                padding: EdgeInsetsDirectional.only(
                  start: r['fromRaiser'] == true ? 0 : Tokens.sp5,
                ),
                child: Card(
                  key: Key('sqReply-${r['id']}'),
                  child: Padding(
                    padding: const EdgeInsets.all(Tokens.sp4),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Wrap(
                          spacing: Tokens.sp1,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            Text(
                              '${r['author'] ?? (r['authorKind'] == 'provider' ? s.sqProvider : '')} · ${_when(s, r['createdAt'])}',
                              style: TextStyle(color: muted, fontSize: 13),
                            ),
                            if (r['isInternal'] == true)
                              Tag(s.sqInternalTag, color: Tokens.mobAmber50),
                          ],
                        ),
                        SelectionArea(child: Text('${r['body'] ?? ''}')),
                        files(r['fileIds'] as List? ?? const [], '${r['author'] ?? ''}'),
                      ],
                    ),
                  ),
                ),
              ),
            if (q['resolution'] != null && status == 'closed') ...[
              const SizedBox(height: Tokens.sp3),
              Notice(
                key: const Key('sqResolution'),
                text: '${s.qryResolution}: ${q['resolution']}',
              ),
            ],
            if (you['handler'] != true && you['raiser'] != true && status != 'closed') ...[
              const SizedBox(height: Tokens.sp3),
              Notice(key: const Key('sqOnlyThey'), text: s.sqOnlyThey(_who(q))),
            ],
            if (you['canReply'] == true) ...[
              SectionTitle(s.qryReply),
              TextField(
                key: const Key('sqReplyText'),
                controller: _reply,
                maxLines: 3,
                maxLength: 5000,
                decoration: box(s.qryReply),
              ),
              QueryFilesField(
                files: _replyFiles,
                onChanged: (f) => setState(() => _replyFiles = f),
                name: 'sqReply',
              ),
              if (you['handler'] == true && you['raiser'] != true)
                CheckboxListTile(
                  key: const Key('sqInternal'),
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: _internal,
                  onChanged: (v) => setState(() => _internal = v ?? false),
                  title: Text(s.sqInternal),
                ),
              const SizedBox(height: Tokens.sp2),
              Align(
                alignment: Alignment.centerLeft,
                child: FilledButton(
                  key: const Key('sqReplySend'),
                  onPressed: _busy
                      ? null
                      : () {
                          if (_reply.text.trim().isEmpty) {
                            return setState(() => _error = s.qryNeedDetails);
                          }
                          _do(() async {
                            await api.helpdeskReply(
                              id: widget.id,
                              body: TicketReplyDto(
                                body: _reply.text.trim(),
                                fileIds: await uploadQueryFiles(ref, _replyFiles),
                                isInternal: _internal,
                              ),
                            );
                          });
                        },
                  child: Text(s.qrySend),
                ),
              ),
            ],
            if (you['canClose'] == true) ...[
              SectionTitle(s.sqResolveClose),
              TextField(
                key: const Key('sqResolutionText'),
                controller: _resolution,
                maxLines: 3,
                maxLength: 5000,
                decoration: box(s.sqHowResolved),
              ),
              QueryFilesField(
                files: _closeFiles,
                onChanged: (f) => setState(() => _closeFiles = f),
                name: 'sqClose',
              ),
              const SizedBox(height: Tokens.sp2),
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton(
                  key: const Key('sqCloseBtn'),
                  onPressed: _busy
                      ? null
                      : () {
                          if (_resolution.text.trim().length < 3) {
                            return setState(() => _error = s.sqNeedResolution);
                          }
                          _do(() async {
                            await api.helpdeskClose(
                              id: widget.id,
                              body: CloseTicketDto(
                                resolution: _resolution.text.trim(),
                                fileIds: await uploadQueryFiles(ref, _closeFiles),
                              ),
                            );
                          });
                        },
                  child: Text(s.sqCloseResolved),
                ),
              ),
            ],
            if (you['canAssign'] == true) ...[
              SectionTitle(s.sqHandOver),
              AsyncBody<Json>(
                value: ref.watch(_assigneesProvider),
                retry: () => ref.invalidate(_assigneesProvider),
                data: (people) => DropdownMenu<String>(
                  key: const Key('sqTo'),
                  label: Text(s.sqTo),
                  trailingIcon: dropArrow(s.sqTo),
                  selectedTrailingIcon: dropArrow(s.sqTo, open: true),
                  expandedInsets: EdgeInsets.zero,
                  enableFilter: true,
                  enableSearch: true,
                  requestFocusOnTap: true,
                  initialSelection: _to,
                  onSelected: (v) => setState(() => _to = v),
                  dropdownMenuEntries: [
                    for (final r in asList(people['roles']))
                      DropdownMenuEntry(
                        value: 'role:${r['code']}',
                        label: s.sqRole('${r['name']}', r['people'] as String?),
                      ),
                    for (final p in asList(people['staff']))
                      DropdownMenuEntry(value: 'user:${p['id']}', label: '${p['name']}'),
                  ],
                ),
              ),
              const SizedBox(height: Tokens.sp2),
              TextField(
                key: const Key('sqHandNote'),
                controller: _note,
                maxLines: 2,
                maxLength: 1000,
                decoration: box(s.sqNoteThem),
              ),
              const SizedBox(height: Tokens.sp2),
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton(
                  key: const Key('sqHandOverBtn'),
                  onPressed: _busy
                      ? null
                      : () {
                          final to = _to;
                          if (to == null) return setState(() => _error = s.sqChooseWho);
                          final note = _note.text.trim();
                          _do(
                            () => api.helpdeskAssign(
                              id: widget.id,
                              body: AssignTicketDto(
                                roleCode: to.startsWith('role:') ? to.substring(5) : null,
                                userId: to.startsWith('user:') ? to.substring(5) : null,
                                note: note.isEmpty ? null : note,
                              ),
                            ),
                          );
                        },
                  child: Text(s.sqHandOverBtn),
                ),
              ),
            ],
            if (you['canReopen'] == true) ...[
              SectionTitle(s.qryNotResolved),
              TextField(
                key: const Key('sqReopenReason'),
                controller: _reason,
                maxLines: 3,
                maxLength: 2000,
                decoration: box(s.qryWhyReopen),
              ),
              QueryFilesField(
                files: _reopenFiles,
                onChanged: (f) => setState(() => _reopenFiles = f),
                name: 'sqReopen',
              ),
              if (you['reopenUntil'] != null)
                Text(
                  s.qryReopenUntil(s.date('${you['reopenUntil']}'.split('T').first)),
                  style: TextStyle(color: muted, fontSize: 13),
                ),
              const SizedBox(height: Tokens.sp2),
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton(
                  key: const Key('sqReopen'),
                  onPressed: _busy
                      ? null
                      : () {
                          if (_reason.text.trim().length < 3) {
                            return setState(() => _error = s.qryNeedReason);
                          }
                          _do(() async {
                            await api.helpdeskReopen(
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
              ),
            ],
            if (you['canRate'] == true && q['rating'] == null) ...[
              SectionTitle(s.qryHowHandled),
              QueryStars(
                value: _rating,
                onChanged: (n) => setState(() => _rating = n),
                s: s,
                name: 'sqRateStar',
              ),
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton(
                  key: const Key('sqRate'),
                  onPressed: _busy
                      ? null
                      : () {
                          if (_rating == 0) return setState(() => _error = s.qryChooseRating);
                          _do(
                            () => api.helpdeskRate(
                              id: widget.id,
                              body: RateTicketDto(rating: _rating),
                            ),
                          );
                        },
                  child: Text(s.qryRate),
                ),
              ),
            ] else if (q['rating'] != null && you['raiser'] == true) ...[
              const SizedBox(height: Tokens.sp3),
              Text(
                s.qryYouRated((q['rating'] as num).toInt()),
                key: const Key('sqRated'),
                style: TextStyle(color: muted, fontSize: 14),
              ),
            ],
            SectionTitle(s.sqTimeline),
            for (final e in asList(q['events']))
              Padding(
                padding: const EdgeInsets.only(bottom: Tokens.sp1),
                child: Text(
                  '• ${s.sqEvent('${e['kind']}')}${e['to'] != null ? ' ${e['to']}' : ''} · ${_when(s, e['at'])}',
                ),
              ),
          ],
        );
      },
    );
  }
}
