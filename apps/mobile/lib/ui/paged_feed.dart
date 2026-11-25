import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../family/common.dart';
import '../family/data.dart';
import '../l10n/strings.dart';
import '../theme/tokens.g.dart';
import 'widgets.dart';

/// The words of a list that loads as it scrolls.
extension PagedFeedWords on S {
  String _pf(String en, String hi) => hindi ? hi : en;

  String get pfMore => _pf('Show more', 'और दिखाएँ');
  String get pfEnd => _pf('That is everything.', 'बस इतना ही।');
  String get pfFailed => _pf('Could not load more.', 'और लोड नहीं हो सका।');
}

/// Bumped when a paged list's items change elsewhere (a decision on a detail screen, a new one raised): the list
/// keyed by it loads again from the newest. One counter per list name ('files', 'indents', 'tickets').
final feedRoundProvider = NotifierProvider.family<FeedRound, int, String>(FeedRound.new);

class FeedRound extends Notifier<int> {
  FeedRound(this.list);

  /// the list's name
  final String list;

  @override
  int build() => 0;

  void bump() => state++;
}

/// One page of a list the API hands out in pages: its items, whether more come, and how many in all when known.
typedef FeedPage = ({List<Json> items, bool more, int? total});

/// A list the API hands out in pages, as the staff website's: the latest [pageSize] first, then the next page by
/// itself as the person nears the end (and a Show more button for a keyboard or a screen reader); pulled down, it
/// starts again from the newest. The first page is kept on the phone ([firstCacheKey]) for reading offline.
class PagedFeed extends ConsumerStatefulWidget {
  const PagedFeed({
    super.key,
    required this.load,
    required this.parse,
    this.item,
    this.group,
    required this.empty,
    this.header,
    this.firstCacheKey,
    this.emptyCard,
    this.onAnswer,
    this.footer = const [],
    this.endGap = 0,
    this.nested = false,
    this.listKey,
  }) : assert(item != null || group != null, 'an item or a group');

  /// the API's answer for a page (1, 2, …)
  final Future<dynamic> Function(int page) load;

  /// the items of an answer, whether more come, and the total when the API says
  final FeedPage Function(Json answer, int page) parse;

  /// one item; [replace] puts a changed copy in its place (read, acknowledged)
  final Widget Function(BuildContext context, Json item, void Function(Json) replace)? item;

  /// instead of [item]: every item loaded so far at once (a list grouped by date, class and subject, whose groups
  /// may grow as the next page comes)
  final List<Widget> Function(BuildContext context, List<Json> items)? group;

  /// what stands above the items (a title, the filters, figures), given the total and the latest answer once known
  final List<Widget> Function(int? total, Json? answer)? header;

  /// said when there is nothing at all
  final String empty;

  /// shown instead of [empty] when there is nothing at all (a card with a title and a line)
  final Widget? emptyCard;

  /// each page's whole answer, for what stands outside the list (tab counts)
  final void Function(Json answer)? onAnswer;

  /// what stands after the foot (a link)
  final List<Widget> footer;

  /// room after the foot (for a floating button)
  final double endGap;

  /// inside a NestedScrollView's tab (under a header that scrolls away): the list takes the view's own scrolling and
  /// notices the end from its scroll notifications
  final bool nested;

  /// the list's key (a PageStorageKey keeps a tab's place)
  final Key? listKey;
  final String? firstCacheKey;

  @override
  ConsumerState<PagedFeed> createState() => _PagedFeedState();
}

class _PagedFeedState extends ConsumerState<PagedFeed> {
  final _scroll = ScrollController();
  final _items = <Json>[];
  int _page = 0;
  bool _more = true;
  int? _total;
  Json? _answer;
  bool _busy = false;
  Object? _error;
  DateTime? _staleAt;

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_nearEnd);
    _next();
  }

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  void _nearEnd() {
    if (_scroll.hasClients && _scroll.position.extentAfter < 400) _next();
  }

  /// nested: near the end, or a first page that leaves the view short, brings the next page
  bool _onNotice(Notification n) {
    final m = n is ScrollNotification
        ? n.metrics
        : n is ScrollMetricsNotification
        ? n.metrics
        : null;
    final depth = n is ScrollNotification
        ? n.depth
        : n is ScrollMetricsNotification
        ? n.depth
        : 1;
    if (m != null && depth == 0 && m.extentAfter < 400) _next();
    return false;
  }

  Future<void> _next() async {
    if (_busy || !_more) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final page = _page + 1;
    try {
      dynamic answer;
      if (page == 1 && widget.firstCacheKey != null) {
        final r = await cached(widget.firstCacheKey!, () => widget.load(1));
        answer = r.data;
        _staleAt = r.stale ? r.at : null;
      } else {
        answer = await widget.load(page);
      }
      final json = asJson(answer);
      final p = widget.parse(json, page);
      if (!mounted) return;
      final seen = {for (final x in _items) '${x['id']}'};
      setState(() {
        _items.addAll(p.items.where((x) => !seen.contains('${x['id']}')));
        _page = page;
        _more = p.more && p.items.isNotEmpty;
        _total = p.total ?? _total;
        _answer = json;
      });
      widget.onAnswer?.call(json);
      // a short first page that does not fill the screen: bring the next one too
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted &&
            !widget.nested &&
            _scroll.hasClients &&
            _scroll.position.maxScrollExtent <= 0) {
          _next();
        }
      });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _refresh() async {
    setState(() {
      _items.clear();
      _page = 0;
      _more = true;
      _total = null;
      _answer = null;
      _error = null;
    });
    await _next();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).brightness == Brightness.dark
        ? Tokens.mobGray300
        : Tokens.textMuted;
    final list = ListView(
      key: widget.listKey,
      controller: widget.nested ? null : _scroll,
      padding: const EdgeInsets.all(Tokens.sp4),
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        if (_staleAt != null) ...[StaleLine(at: _staleAt!), const SizedBox(height: Tokens.sp3)],
        ...?widget.header?.call(_total, _answer),
        if (widget.group != null)
          ...widget.group!(context, _items)
        else
          for (var i = 0; i < _items.length; i++)
            widget.item!(context, _items[i], (changed) => setState(() => _items[i] = changed)),
        if (_busy)
          Padding(
            padding: const EdgeInsets.all(Tokens.sp4),
            child: Center(
              child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
            ),
          )
        else if (_error != null)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: Tokens.sp3),
            child: Column(
              children: [
                ErrorText(_items.isEmpty ? errorText(s, _error!) : s.pfFailed),
                OutlinedButton(key: const Key('feedRetry'), onPressed: _next, child: Text(s.retry)),
              ],
            ),
          )
        else if (_items.isEmpty)
          widget.emptyCard ?? EmptyLine(widget.empty)
        else if (_more)
          Center(
            child: TextButton(key: const Key('feedMore'), onPressed: _next, child: Text(s.pfMore)),
          )
        else
          Padding(
            padding: const EdgeInsets.symmetric(vertical: Tokens.sp3),
            child: Center(
              child: Text(
                s.pfEnd,
                key: const Key('feedEnd'),
                style: TextStyle(color: muted),
              ),
            ),
          ),
        ...widget.footer,
        if (widget.endGap > 0) SizedBox(height: widget.endGap),
      ],
    );
    return RefreshIndicator(
      onRefresh: _refresh,
      child: widget.nested
          ? NotificationListener<Notification>(onNotification: _onNotice, child: list)
          : list,
    );
  }
}
