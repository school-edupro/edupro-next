import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart' show ApiException;
import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../family/messages.dart' show NoticeTile;
import '../ui/paged_feed.dart';
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

class _List extends ConsumerStatefulWidget {
  const _List({required this.profile, required this.all});
  final Profile profile;
  final bool all;

  @override
  ConsumerState<_List> createState() => _ListState();
}

/// One tab: the latest 10, then 10 more as the list scrolls (as the staff website); back from a notice (it may have
/// been acknowledged there) the list reads again from the newest.
class _ListState extends ConsumerState<_List> {
  int _round = 0;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final p = widget.profile;
    return PagedFeed(
      key: ValueKey('ooFeed-${widget.all}-$_round'),
      firstCacheKey: 'office-orders-feed:${p.id}:${widget.all}',
      load: (page) async {
        try {
          return await ref
              .read(apiProvider)
              .noticesList(kind: widget.all ? null : 'office_order', page: page, size: 10);
        } on ApiException catch (e) {
          // as the website: no right to read them is an empty list
          if (e.status == 403) {
            return {
              'data': <Object>[],
              'page': {'total': 0},
            };
          }
          rethrow;
        }
      },
      parse: (a, page) {
        final total = (asJson(a['page'])['total'] as num?)?.toInt() ?? 0;
        return (items: asList(a['data']), more: page * 10 < total, total: total);
      },
      header: (_) => [
        Text(s.ooHelp, style: const TextStyle(fontSize: 13)),
        const SizedBox(height: Tokens.sp3),
      ],
      // as the notices' card: date block, tags, first lines, for whom, attachments, Details (the text, files and
      // Acknowledge open there)
      item: (context, n, _) => NoticeTile(
        key: Key('ooOrder-${n['id']}'),
        profile: p,
        notice: n,
        pending: n['ackRequired'] == true && n['ackedByMe'] != true,
        onClosed: () {
          ref.invalidate(officeOrdersProvider);
          setState(() => _round++);
        },
      ),
      empty: s.ooNone,
    );
  }
}
