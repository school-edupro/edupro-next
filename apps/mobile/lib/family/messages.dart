import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'common.dart';
import 'data.dart';

/// A parent's Messages tab: the school's messages about the child, the notices and circulars, and the queries to
/// the school (its web page).
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
                onPressed: () => context.push(
                  Uri(
                    path: '/web',
                    queryParameters: {
                      'app': widget.profile.app,
                      'to': '/queries',
                      'title': s.queries,
                    },
                  ).toString(),
                ),
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
    final first = (profile, 1);
    return LoadedList<Json>(
      value: ref.watch(inboxProvider(first)),
      refresh: () => ref.refresh(inboxProvider(first).future),
      children: (inbox) => [
        if (asList(inbox['data']).isEmpty) EmptyLine(s.nothingYet),
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
              '${m['subject'] ?? m['title']}',
              style: m['unread'] == true ? const TextStyle(fontWeight: Tokens.fwBold) : null,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            subtitle: Text(
              '${s.dateTime(DateTime.parse('${m['sentAt']}'))}\n${m['text']}',
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

/// One message in full, with its attachments.
class MessageDetail extends ConsumerWidget {
  const MessageDetail({super.key, required this.message});
  final Json message;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final m = message;
    final files = asList(m['attachments']);
    final html = m['html'] as String?;
    return ListView(
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        if (m['subject'] != null)
          Semantics(
            header: true,
            child: Text('${m['subject']}', style: Theme.of(context).textTheme.titleLarge),
          ),
        Text(
          s.dateTime(DateTime.parse('${m['sentAt']}')),
          style: Theme.of(context).textTheme.bodySmall,
        ),
        const SizedBox(height: Tokens.sp4),
        SelectionArea(
          child: Text(html != null && html.isNotEmpty ? plainText(html) : '${m['text']}'),
        ),
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
      ],
    );
  }
}

/// Notices and circulars for the child's family, pinned first.
class NoticesList extends ConsumerWidget {
  const NoticesList({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return LoadedList<List<Json>>(
      value: ref.watch(noticesProvider(profile)),
      refresh: () => ref.refresh(noticesProvider(profile).future),
      children: (notices) {
        final list = [...notices]
          ..sort((a, b) {
            final pin = (b['isPinned'] == true ? 1 : 0) - (a['isPinned'] == true ? 1 : 0);
            return pin != 0 ? pin : '${b['publishFrom']}'.compareTo('${a['publishFrom']}');
          });
        return [
          if (list.isEmpty) EmptyLine(s.nothingYet),
          for (final n in list) NoticeTile(profile: profile, notice: n),
        ];
      },
    );
  }
}

class NoticeTile extends ConsumerWidget {
  const NoticeTile({super.key, required this.profile, required this.notice});
  final Profile profile;
  final Json notice;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final n = notice;
    return Card(
      child: ListTile(
        key: Key('notice-${n['id']}'),
        leading: Icon(n['isPinned'] == true ? Icons.push_pin_outlined : Icons.campaign_outlined),
        title: Text('${n['title']}', maxLines: 2, overflow: TextOverflow.ellipsis),
        subtitle: Text(s.date('${n['publishFrom']}'.split('T').first)),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => pushPage(context, s.notices, NoticeDetail(profile: profile, id: '${n['id']}')),
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
        return [
          Semantics(
            header: true,
            child: Text('${n['title']}', style: Theme.of(context).textTheme.titleLarge),
          ),
          Text(
            [
              s.date('${n['publishFrom']}'.split('T').first),
              if (n['publishedBy'] != null) s.postedBy('${n['publishedBy']}'),
            ].join(' · '),
            style: Theme.of(context).textTheme.bodySmall,
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
