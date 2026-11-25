import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import '../ui/paged_feed.dart';
import 'common.dart';
import 'data.dart';
import 'queries.dart';

/// A parent's Messages tab: the school's messages about the child, the notices and circulars, and the queries to
/// the school.
class MessagesScreen extends ConsumerStatefulWidget {
  const MessagesScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<MessagesScreen> createState() => _MessagesScreenState();
}

class _MessagesScreenState extends ConsumerState<MessagesScreen> {
  bool _notices = false;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(Tokens.sp4, Tokens.sp3, Tokens.sp4, 0),
          child: Row(
            children: [
              Expanded(
                child: SegmentedButton<bool>(
                  key: const Key('messagesOrNotices'),
                  segments: [
                    ButtonSegment(value: false, label: Text(s.messages)),
                    ButtonSegment(value: true, label: Text(s.notices)),
                  ],
                  selected: {_notices},
                  onSelectionChanged: (v) => setState(() => _notices = v.first),
                ),
              ),
              IconButton(
                tooltip: s.queries,
                icon: const Icon(Icons.support_agent_outlined),
                onPressed: () =>
                    pushPage(context, s.queries, QueriesScreen(profile: widget.profile)),
              ),
            ],
          ),
        ),
        Expanded(
          child: _notices
              ? NoticesList(profile: widget.profile)
              : InboxList(profile: widget.profile),
        ),
      ],
    );
  }
}

/// The school's messages (SMS, WhatsApp, e-mail, app) about the child, the newest first.
class InboxList extends ConsumerWidget {
  const InboxList({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    if (profile.isStaff) {
      // the staff app: the latest 10 messages, then 10 more as the person scrolls (as the staff website)
      final muted = Theme.of(context).brightness == Brightness.dark
          ? Tokens.mobGray300
          : Tokens.textMuted;
      return PagedFeed(
        key: const Key('inboxFeed'),
        firstCacheKey: 'inbox-feed:${profile.id}',
        load: (page) => ref.read(apiProvider).commsInboxList(page: page, size: 10),
        parse: (a, _) =>
            (items: asList(a['data']), more: asJson(a['page'])['more'] == true, total: null),
        header: (_, _) => [
          Text(
            s.messagesTitle,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
          ),
          Text(s.messagesHelp, style: TextStyle(color: muted, fontSize: 14)),
          const SizedBox(height: Tokens.sp3),
        ],
        item: (context, m, replace) => MessageCard(
          message: m,
          onOpen: () {
            _InboxPage._open(context, ref, profile, m);
            if (m['unread'] == true) replace({...m, 'unread': false});
          },
        ),
        empty: s.noMessagesYet,
      );
    }
    final first = (profile, 1);
    return LoadedList<Json>(
      value: ref.watch(inboxProvider(first)),
      refresh: () => ref.refresh(inboxProvider(first).future),
      children: (inbox) => [
        Text(
          s.messagesTitle,
          style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
        ),
        Text(
          s.messagesHelp,
          style: TextStyle(
            color: (Theme.of(context).brightness == Brightness.dark
                ? Tokens.mobGray300
                : Tokens.textMuted),
            fontSize: 14,
          ),
        ),
        const SizedBox(height: Tokens.sp3),
        if (asList(inbox['data']).isEmpty) EmptyLine(s.noMessagesYet),
        ..._InboxPage.items(context, ref, profile, inbox),
        if (asJson(inbox['page'])['more'] == true) _InboxPage(profile: profile, page: 2),
      ],
    );
  }
}

/// The next page of messages, shown after "Show more" (and offering the page after it).
class _InboxPage extends ConsumerStatefulWidget {
  const _InboxPage({required this.profile, required this.page});
  final Profile profile;
  final int page;

  static List<Widget> items(BuildContext context, WidgetRef ref, Profile profile, Json inbox) {
    final s = ref.read(stringsProvider);
    return [
      for (final m in asList(inbox['data']))
        if (profile.isStaff)
          // the staff app: each message as the notices' card (date block, tags, first lines, Details)
          MessageCard(message: m, onOpen: () => _open(context, ref, profile, m))
        else
          Card(
            child: ListTile(
              key: Key('message-${m['id']}'),
              leading: m['unread'] == true
                  ? Semantics(
                      label: s.unreadMessages,
                      child: const Icon(Icons.circle, size: 12, color: Tokens.mobCyan600),
                    )
                  : const SizedBox(width: 12),
              title: Text(
                '${m['title'] ?? m['subject']}',
                style: m['unread'] == true ? const TextStyle(fontWeight: Tokens.fwBold) : null,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              // as the website: when · the child · the channels, then the first words
              subtitle: Text(
                '${messageMeta(s, m)}\n${'${m['text'] ?? ''}'.replaceAll(RegExp(r'\s+'), ' ')}',
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
              ),
              isThreeLine: true,
              onTap: () => _open(context, ref, profile, m),
            ),
          ),
    ];
  }

  static void _open(BuildContext context, WidgetRef ref, Profile profile, Json m) {
    final ids = [for (final x in (m['messageIds'] as List? ?? const [])) '$x'];
    if (m['unread'] == true && ids.isNotEmpty) {
      // best effort: the list and the badge catch up on the next refresh
      ref
          .read(apiProvider)
          .commsInboxRead(body: CommsInboxReadDto(ids: ids))
          .then((_) {
            ref.invalidate(inboxProvider);
            ref.invalidate(unreadProvider(profile));
          })
          .catchError((_) {});
    }
    pushPage(context, '${m['title']}', MessageDetail(message: m));
  }

  @override
  ConsumerState<_InboxPage> createState() => _InboxPageState();
}

class _InboxPageState extends ConsumerState<_InboxPage> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    if (!_open) {
      return OutlinedButton(
        key: Key('more-${widget.page}'),
        onPressed: () => setState(() => _open = true),
        child: Text(s.loadMore),
      );
    }
    return switch (ref.watch(inboxProvider((widget.profile, widget.page)))) {
      AsyncValue(:final value?) => Column(
        children: [
          ..._InboxPage.items(context, ref, widget.profile, value.data),
          if (asJson(value.data['page'])['more'] == true)
            _InboxPage(profile: widget.profile, page: widget.page + 1),
        ],
      ),
      AsyncValue(:final error?) => ErrorText(errorText(s, error)),
      _ => const LinearProgressIndicator(),
    };
  }
}

/// When a message came, for whom and by which channels: 19 Nov 2026, 10:42 · Kid · SMS + WhatsApp
String messageMeta(S s, Json m) => [
  s.dateTime(DateTime.parse('${m['sentAt']}')),
  if (asJson(m['student'])['name'] != null) '${asJson(m['student'])['name']}',
  [for (final c in (m['channels'] as List? ?? const [])) s.channel('$c')].join(' + '),
].where((x) => x.isNotEmpty).join(' · ');

/// One message in full as the website opens it: the subject, the text, the e-mail as it was formatted, the
/// attachments, and how it reached the family on each channel.
class MessageDetail extends ConsumerWidget {
  const MessageDetail({super.key, required this.message});
  final Json message;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final m = message;
    final files = asList(m['attachments']);
    final html = m['html'] as String?;
    final status = asJson(m['status']);
    final delivery = [
      for (final e in status.entries) '${s.channel(e.key)}: ${s.deliveryState('${e.value}')}',
      if (m['readOnPhone'] == true) s.deliveryState('read'),
    ].join(' · ');
    return ListView(
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        if (m['subject'] != null)
          Semantics(
            header: true,
            child: Text('${m['subject']}', style: Theme.of(context).textTheme.titleLarge),
          ),
        Text(messageMeta(s, m), style: TextStyle(color: muted, fontSize: 13)),
        const SizedBox(height: Tokens.sp4),
        SelectionArea(child: Text('${m['text'] ?? ''}')),
        if (html != null && html.isNotEmpty) ...[
          const SizedBox(height: Tokens.sp3),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: OutlinedButton.icon(
              key: const Key('openEmail'),
              icon: const Icon(Icons.mail_outline),
              label: Text(s.openEmail),
              onPressed: () => pushPage(
                context,
                '${m['subject'] ?? m['title']}',
                // the e-mail as the school formatted it; no scripts, nothing kept
                InAppWebView(
                  key: const Key('emailBody'),
                  initialData: InAppWebViewInitialData(data: html),
                  initialSettings: InAppWebViewSettings(
                    javaScriptEnabled: false,
                    cacheEnabled: false,
                  ),
                ),
              ),
            ),
          ),
        ],
        const SizedBox(height: Tokens.sp4),
        Attachments(
          count: files.length,
          load: (i) => ref
              .read(transportProvider)
              .download(
                '${files[i]['url']}',
                name: '${files[i]['name']}',
                contentType: '${files[i]['contentType']}',
              ),
        ),
        if (delivery.isNotEmpty) ...[
          const SizedBox(height: Tokens.sp3),
          Text(
            delivery,
            key: const Key('delivery'),
            style: TextStyle(color: muted, fontSize: 13),
          ),
        ],
      ],
    );
  }
}

/// Notices and circulars for the child as the website's Notices page: the type, the dates and words in the
/// notice to filter by; how many, latest first, and how many still to acknowledge; a card for each with its date,
/// tags (pinned, kind, to acknowledge), first lines, for whom, its attachments and who published it.
class NoticesList extends ConsumerStatefulWidget {
  const NoticesList({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<NoticesList> createState() => _NoticesListState();
}

class _NoticesListState extends ConsumerState<NoticesList> {
  String _kind = '';
  String _q = '';
  DateTime? _from;
  DateTime? _to;
  final _words = TextEditingController();
  // the staff list starts again from the newest after a notice was opened
  int _round = 0;

  @override
  void dispose() {
    _words.dispose();
    super.dispose();
  }

  bool get _filtered => _kind.isNotEmpty || _q.isNotEmpty || _from != null || _to != null;

  Future<void> _pick(bool from) async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: (from ? _from : _to) ?? now,
      firstDate: DateTime(now.year - 3),
      lastDate: now,
    );
    if (d != null) setState(() => from ? _from = d : _to = d);
  }

  /// The filters: the type, the dates and words in the notice.
  Widget _filters(S s) => Card(
    child: Padding(
      padding: const EdgeInsets.all(Tokens.sp3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            label: s.notices,
            container: true,
            explicitChildNodes: true,
            child: Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp2,
              children: [
                for (final (v, label) in [
                  ('', s.noticeKindAll),
                  ('notice', s.notices),
                  ('circular', s.circulars),
                ])
                  ChoiceChip(
                    key: Key('noticeKind-${v.isEmpty ? 'all' : v}'),
                    label: Text(label),
                    selected: _kind == v,
                    showCheckmark: false,
                    onSelected: (_) => setState(() => _kind = v),
                  ),
              ],
            ),
          ),
          const SizedBox(height: Tokens.sp2),
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp2,
            children: [
              OutlinedButton.icon(
                key: const Key('noticeFrom'),
                icon: const Icon(Icons.event),
                label: Text('${s.fromWord}: ${_from == null ? '—' : s.date(_from!)}'),
                onPressed: () => _pick(true),
              ),
              OutlinedButton.icon(
                key: const Key('noticeTo'),
                icon: const Icon(Icons.event),
                label: Text('${s.givenTo}: ${_to == null ? '—' : s.date(_to!)}'),
                onPressed: () => _pick(false),
              ),
            ],
          ),
          const SizedBox(height: Tokens.sp2),
          TextField(
            key: const Key('noticeWords'),
            controller: _words,
            maxLength: 80,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              labelText: s.wordsInNotice,
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
                key: const Key('noticeClear'),
                onPressed: () => setState(() {
                  _kind = '';
                  _q = '';
                  _from = null;
                  _to = null;
                  _words.clear();
                }),
                child: Text(s.clearDates),
              ),
            ),
        ],
      ),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final p = widget.profile;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final arg = (p, _kind, _q);
    if (p.isStaff) {
      // the staff app: the latest 10 notices, then 10 more as the person scrolls (as the staff website); the type,
      // the dates and the words go to the API
      final from = _from == null ? null : ymd(_from!);
      final to = _to == null ? null : ymd(_to!);
      return PagedFeed(
        key: ValueKey('noticesFeed-$_kind-$_q-$from-$to-$_round'),
        firstCacheKey: _filtered ? null : 'notices-feed:${p.id}',
        load: (page) => ref
            .read(apiProvider)
            .noticesList(
              kind: _kind.isEmpty ? null : _kind,
              q: _q.isEmpty ? null : _q,
              from: from,
              to: to,
              page: page,
              size: 10,
            ),
        parse: (a, page) {
          final total = (asJson(a['page'])['total'] as num?)?.toInt() ?? 0;
          return (items: asList(a['data']), more: page * 10 < total, total: total);
        },
        header: (total, _) => [
          Text(
            s.noticesTitle,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
          ),
          if (total != null)
            Text(
              s.noticesCount(total, _filtered, 0),
              key: const Key('noticesCount'),
              style: TextStyle(color: muted, fontSize: 14),
            ),
          const SizedBox(height: Tokens.sp3),
          _filters(s),
          const SizedBox(height: Tokens.sp2),
        ],
        item: (context, n, _) => NoticeTile(
          profile: p,
          notice: n,
          pending: n['ackRequired'] == true && n['ackedByMe'] != true,
          // back from a notice (it may have been acknowledged there): the list starts again from the newest
          onClosed: () => setState(() => _round++),
        ),
        empty: _filtered ? s.nothingMatches : s.noNoticesNow,
      );
    }
    return LoadedList<List<Json>>(
      value: ref.watch(noticesFilteredProvider(arg)),
      refresh: () => ref.refresh(noticesFilteredProvider(arg).future),
      children: (notices) {
        final from = _from == null ? '' : ymd(_from!);
        final to = _to == null ? '' : ymd(_to!);
        final list = notices.where((n) {
          final on = '${n['publishFrom']}'.split('T').first;
          return (from.isEmpty || on.compareTo(from) >= 0) && (to.isEmpty || on.compareTo(to) <= 0);
        }).toList();
        bool pending(Json n) =>
            n['ackRequired'] == true &&
            p.studentId != null &&
            !(n['ackedFor'] is List && (n['ackedFor'] as List).contains(p.studentId));
        return [
          Text(
            s.noticesTitle,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
          ),
          Text(
            s.noticesCount(list.length, _filtered, list.where(pending).length),
            key: const Key('noticesCount'),
            style: TextStyle(color: muted, fontSize: 14),
          ),
          const SizedBox(height: Tokens.sp3),
          _filters(s),
          const SizedBox(height: Tokens.sp2),
          if (list.isEmpty) EmptyLine(_filtered ? s.nothingMatches : s.noNoticesNow),
          for (final n in list) NoticeTile(profile: p, notice: n, pending: pending(n)),
        ];
      },
    );
  }
}

/// A notice in the list: the date block, its tags, the first lines, for whom, the attachments and who published it.
class NoticeTile extends ConsumerWidget {
  const NoticeTile({
    super.key,
    required this.profile,
    required this.notice,
    this.pending = false,
    this.onClosed,
  });
  final Profile profile;
  final Json notice;

  /// called when its detail closes (the list reads again: it may have been acknowledged there)
  final VoidCallback? onClosed;

  /// still to acknowledge for this child
  final bool pending;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final n = notice;
    final on = DateTime.tryParse('${n['publishFrom']}'.split('T').first) ?? DateTime.now();
    final body = '${n['body'] ?? ''}';
    var excerpt = (n['bodyFormat'] == 'html' ? plainText(body) : body)
        .replaceAll(RegExp(r'\s+'), ' ')
        .trim();
    if (excerpt.length > 180) excerpt = '${excerpt.substring(0, 180).trimRight()}…';
    final targets = [for (final t in asList(n['targets']).take(3)) '${t['label']}'];
    final files = asList(n['files']).length;
    Future<void> open() async {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => FamilyPage(
            title: s.noticeKind('${n['kind']}'),
            child: NoticeDetail(profile: profile, id: '${n['id']}'),
          ),
        ),
      );
      onClosed?.call();
    }

    return Card(
      child: InkWell(
        key: Key('notice-${n['id']}'),
        onTap: open,
        child: Padding(
          padding: const EdgeInsets.all(Tokens.sp3),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 60,
                padding: const EdgeInsets.symmetric(vertical: Tokens.sp2),
                decoration: BoxDecoration(
                  color: (dark ? Tokens.mobNavy700 : Tokens.mobNavy50),
                  borderRadius: BorderRadius.circular(Tokens.radiusSm),
                ),
                child: Column(
                  children: [
                    Text(
                      on.day.toString().padLeft(2, '0'),
                      style: const TextStyle(fontSize: 20, fontWeight: Tokens.fwBold),
                    ),
                    Text(s.monthShort(on), style: const TextStyle(fontSize: 12)),
                    Text('${on.year}', style: const TextStyle(fontSize: 12)),
                  ],
                ),
              ),
              const SizedBox(width: Tokens.sp3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${n['title']}', style: const TextStyle(fontWeight: Tokens.fwBold)),
                    const SizedBox(height: Tokens.sp1),
                    Wrap(
                      spacing: Tokens.sp1,
                      runSpacing: Tokens.sp1,
                      children: [
                        if (n['isPinned'] == true) StatusChip(s.pinned, Tone.warning),
                        StatusChip(
                          s.noticeKind('${n['kind']}'),
                          n['kind'] == 'circular' ? Tone.info : Tone.neutral,
                        ),
                        if (pending) StatusChip(s.toAcknowledge, Tone.danger),
                      ],
                    ),
                    if (excerpt.isNotEmpty) ...[const SizedBox(height: Tokens.sp1), Text(excerpt)],
                    Text(
                      [
                        if (targets.isNotEmpty) targets.join(', '),
                        if (files > 0) s.attachmentsN(files),
                        if (n['publishedBy'] != null) '${n['publishedBy']}',
                      ].join(' · '),
                      style: TextStyle(color: muted, fontSize: 13),
                    ),
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: TextButton(
                        key: Key('noticeDetails-${n['id']}'),
                        onPressed: open,
                        child: Semantics(
                          label: '${s.details}: ${n['title']}',
                          child: Text(s.details),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A message in the staff app, as the notices' card: the date block, the subject, its tags (new, the channels), the
/// first lines, when it came and its attachments, and Details.
class MessageCard extends ConsumerWidget {
  const MessageCard({super.key, required this.message, required this.onOpen});
  final Json message;
  final VoidCallback onOpen;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final m = message;
    final at = DateTime.tryParse('${m['sentAt']}')?.toLocal() ?? DateTime.now();
    final unread = m['unread'] == true;
    var excerpt = '${m['text'] ?? ''}'.replaceAll(RegExp(r'\s+'), ' ').trim();
    if (excerpt.length > 180) excerpt = '${excerpt.substring(0, 180).trimRight()}…';
    final files = asList(m['attachments']).length;
    final title = '${m['title'] ?? m['subject'] ?? ''}';
    return Card(
      child: InkWell(
        key: Key('message-${m['id']}'),
        onTap: onOpen,
        child: Padding(
          padding: const EdgeInsets.all(Tokens.sp3),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 60,
                padding: const EdgeInsets.symmetric(vertical: Tokens.sp2),
                decoration: BoxDecoration(
                  color: (dark ? Tokens.mobNavy700 : Tokens.mobNavy50),
                  borderRadius: BorderRadius.circular(Tokens.radiusSm),
                ),
                child: Column(
                  children: [
                    Text(
                      at.day.toString().padLeft(2, '0'),
                      style: const TextStyle(fontSize: 20, fontWeight: Tokens.fwBold),
                    ),
                    Text(s.monthShort(at), style: const TextStyle(fontSize: 12)),
                    Text('${at.year}', style: const TextStyle(fontSize: 12)),
                  ],
                ),
              ),
              const SizedBox(width: Tokens.sp3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(title, style: const TextStyle(fontWeight: Tokens.fwBold)),
                    const SizedBox(height: Tokens.sp1),
                    Wrap(
                      spacing: Tokens.sp1,
                      runSpacing: Tokens.sp1,
                      children: [
                        if (unread) StatusChip(s.hindi ? 'नया' : 'New', Tone.info),
                        for (final c in (m['channels'] as List? ?? const []))
                          StatusChip(s.channel('$c'), Tone.neutral),
                      ],
                    ),
                    if (excerpt.isNotEmpty) ...[const SizedBox(height: Tokens.sp1), Text(excerpt)],
                    Text(
                      [
                        '${at.hour.toString().padLeft(2, '0')}:${at.minute.toString().padLeft(2, '0')}',
                        if (asJson(m['student'])['name'] != null) '${asJson(m['student'])['name']}',
                        if (files > 0) s.attachmentsN(files),
                      ].join(' · '),
                      style: TextStyle(color: muted, fontSize: 13),
                    ),
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: TextButton(
                        key: Key('messageDetails-${m['id']}'),
                        onPressed: onOpen,
                        child: Semantics(label: '${s.details}: $title', child: Text(s.details)),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// A notice in full: its text, the files, and "I have seen this" when the school asks for it.
class NoticeDetail extends ConsumerStatefulWidget {
  const NoticeDetail({super.key, required this.profile, required this.id});
  final Profile profile;
  final String id;

  @override
  ConsumerState<NoticeDetail> createState() => _NoticeDetailState();
}

class _NoticeDetailState extends ConsumerState<NoticeDetail> {
  bool _busy = false;

  Future<void> _ack() async {
    final s = ref.read(stringsProvider);
    setState(() => _busy = true);
    try {
      await ref
          .read(apiProvider)
          .documentsAck(
            body: AckDto(type: 'notice', id: widget.id, studentId: widget.profile.studentId),
          );
      ref.invalidate(noticeProvider((widget.profile, widget.id)));
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final arg = (widget.profile, widget.id);
    return LoadedList<Json>(
      value: ref.watch(noticeProvider(arg)),
      refresh: () => ref.refresh(noticeProvider(arg).future),
      children: (n) {
        final files = asList(n['files']);
        final body = '${n['body'] ?? ''}';
        // a family acknowledges for a child; staff for themselves
        final seen = widget.profile.studentId == null
            ? n['ackedByMe'] == true
            : n['ackedFor'] is List && (n['ackedFor'] as List).contains(widget.profile.studentId);
        final on = DateTime.tryParse('${n['publishFrom']}'.split('T').first);
        return [
          Text(s.noticeKind('${n['kind']}'), style: Theme.of(context).textTheme.labelLarge),
          Semantics(
            header: true,
            child: Text('${n['title']}', style: Theme.of(context).textTheme.titleLarge),
          ),
          Text(
            [
              if (on != null) '${s.dayLong(on)} ${on.year}',
              if (n['publishedBy'] != null) '${n['publishedBy']}',
            ].join(' · '),
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: Tokens.sp2),
          Wrap(
            spacing: Tokens.sp1,
            runSpacing: Tokens.sp1,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (n['isPinned'] == true) StatusChip(s.pinned, Tone.warning),
              StatusChip(
                s.noticeKind('${n['kind']}'),
                n['kind'] == 'circular' ? Tone.info : Tone.neutral,
              ),
              if (asList(n['targets']).isNotEmpty)
                Text(
                  [for (final t in asList(n['targets']).take(6)) '${t['label']}'].join(', '),
                  style: Theme.of(context).textTheme.bodySmall,
                ),
            ],
          ),
          const SizedBox(height: Tokens.sp4),
          SelectionArea(child: Text(n['bodyFormat'] == 'html' ? plainText(body) : body)),
          const SizedBox(height: Tokens.sp4),
          Attachments(
            count: files.length,
            load: (i) =>
                ref.read(apiProvider).noticesFile(id: widget.id, fileId: '${files[i]['id']}'),
          ),
          if (n['ackRequired'] == true) ...[
            const SizedBox(height: Tokens.sp4),
            seen
                ? Row(
                    children: [
                      const Icon(Icons.check_circle, color: Tokens.statusSuccess),
                      const SizedBox(width: Tokens.sp2),
                      Text(s.acknowledged),
                    ],
                  )
                : FilledButton(
                    key: const Key('ackNotice'),
                    onPressed: _busy ? null : _ack,
                    child: Text(s.acknowledge),
                  ),
          ],
        ];
      },
    );
  }
}
