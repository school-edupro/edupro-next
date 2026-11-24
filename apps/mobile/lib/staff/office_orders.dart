import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart' show ApiException;
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'data.dart';

/// The words of Office orders (as the staff website's, in English and Hindi).
extension OfficeOrderWords on S {
  String _o(String en, String hi) => hindi ? hi : en;

  String get ooHelp => _o(
    'Orders and circulars the school issued for staff.',
    'विद्यालय द्वारा कर्मचारियों के लिए जारी आदेश और परिपत्र।',
  );
  String get ooOrdersTab => _o('Office orders', 'कार्यालय आदेश');
  String get ooAllTab => _o('All notices for staff', 'कर्मचारियों की सभी सूचनाएँ');
  String get ooNone => _o('Nothing has been issued yet.', 'अभी कुछ जारी नहीं हुआ।');
  String ooKind(String k) => switch (k) {
    'office_order' => _o('Office order', 'कार्यालय आदेश'),
    'circular' => _o('Circular', 'परिपत्र'),
    _ => _o('Notice', 'सूचना'),
  };
  String get ooAttachments => _o('Attachments', 'संलग्नक');
  String ooAttachment(int n, String title) => _o('attachment $n of $title', '$title का संलग्नक $n');
  String get ooAck => _o('Acknowledge', 'स्वीकार करें');
  String get ooAcked => _o('You acknowledged this', 'आपने इसे स्वीकार किया');
  String get ooAckDone => _o('Acknowledged.', 'स्वीकार किया गया।');
}

/// One list: `(profile, all)` — the office orders, or every notice for staff.
final officeOrdersProvider = FutureProvider.autoDispose.family<Loaded<List<Json>>, (Profile, bool)>(
  (ref, k) async {
    final (p, all) = k;
    try {
      final r = await cached(
        'office-orders:${p.id}:$all',
        () => ref.read(apiProvider).noticesList(size: 100, kind: all ? null : 'office_order'),
      );
      return Loaded(asList(asJson(r.data)['data']), r.at, stale: r.stale);
    } on ApiException catch (e) {
      // as the website: no right to read them is an empty list
      if (e.status == 403) return Loaded(const <Json>[], DateTime.now());
      rethrow;
    }
  },
);

/// Office orders as on the staff website: the orders (or every notice for staff) the school published, newest
/// first, each with its date, who issued it, the text, its attachments (View / Download) and — when it asks for it —
/// Acknowledge. No web page.
class OfficeOrdersScreen extends ConsumerWidget {
  const OfficeOrdersScreen({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return DefaultTabController(
      length: 2,
      child: Column(
        children: [
          Material(
            color: Theme.of(context).colorScheme.surface,
            child: TabBar(
              key: const Key('ooTabs'),
              isScrollable: true,
              tabAlignment: TabAlignment.start,
              tabs: [
                Tab(text: s.ooOrdersTab),
                Tab(text: s.ooAllTab),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              children: [
                _List(profile: profile, all: false),
                _List(profile: profile, all: true),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _List extends ConsumerWidget {
  const _List({required this.profile, required this.all});
  final Profile profile;
  final bool all;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final key = (profile, all);
    return LoadedList<List<Json>>(
      value: ref.watch(officeOrdersProvider(key)),
      refresh: () => ref.refresh(officeOrdersProvider(key).future),
      children: (rows) => [
        Text(s.ooHelp, style: const TextStyle(fontSize: 13)),
        const SizedBox(height: Tokens.sp3),
        if (rows.isEmpty) Notice(text: s.ooNone),
        for (final n in rows) _Order(profile: profile, notice: n),
      ],
    );
  }
}

class _Order extends ConsumerStatefulWidget {
  const _Order({required this.profile, required this.notice});
  final Profile profile;
  final Json notice;

  @override
  ConsumerState<_Order> createState() => _OrderState();
}

class _OrderState extends ConsumerState<_Order> {
  bool _busy = false;

  Future<void> _ack() async {
    final s = ref.read(stringsProvider);
    setState(() => _busy = true);
    try {
      await ref
          .read(apiProvider)
          .documentsAck(
            body: AckDto(type: 'notice', id: '${widget.notice['id']}'),
          );
      ref.invalidate(officeOrdersProvider);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.ooAckDone)));
      }
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
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final n = widget.notice;
    final id = '${n['id']}';
    final kind = '${n['kind']}';
    final body = '${n['body'] ?? ''}';
    final files = asList(n['files']);
    return Card(
      key: Key('ooOrder-$id'),
      margin: const EdgeInsets.only(bottom: Tokens.sp3),
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    '${n['title'] ?? ''}',
                    style: const TextStyle(fontWeight: Tokens.fwBold, fontSize: 16),
                  ),
                ),
                const SizedBox(width: Tokens.sp2),
                Flexible(
                  child: Tag(
                    s.ooKind(kind),
                    color: kind == 'office_order' ? Tokens.mobCyan100 : Tokens.mobGray100,
                  ),
                ),
              ],
            ),
            Text(
              [
                if (n['publishFrom'] != null) s.date('${n['publishFrom']}'),
                if (n['publishedBy'] != null) '${n['publishedBy']}',
              ].join(' · '),
              style: TextStyle(color: muted, fontSize: 13),
            ),
            const SizedBox(height: Tokens.sp2),
            SelectionArea(child: Text(n['bodyFormat'] == 'html' ? plainText(body) : body)),
            if (files.isNotEmpty) ...[
              const SizedBox(height: Tokens.sp2),
              Wrap(
                spacing: Tokens.sp2,
                runSpacing: Tokens.sp1,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(s.ooAttachments, style: TextStyle(color: muted, fontSize: 13)),
                  for (final (i, f) in files.indexed)
                    FileIcons(
                      name: 'ooFile-${f['id']}',
                      label: s.ooAttachment(i + 1, '${n['title'] ?? ''}'),
                      load: () => ref.read(apiProvider).noticesFile(id: id, fileId: '${f['id']}'),
                    ),
                ],
              ),
            ],
            if (n['ackRequired'] == true) ...[
              const SizedBox(height: Tokens.sp2),
              if (n['ackedByMe'] == true)
                StatusChip(s.ooAcked, Tone.success)
              else
                FilledButton(
                  key: Key('ooAck-$id'),
                  onPressed: _busy ? null : _ack,
                  child: Text(s.ooAck),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
