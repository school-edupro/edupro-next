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
    required this.item,
    required this.empty,
    this.header,
    this.firstCacheKey,
  });

  /// the API's answer for a page (1, 2, …)
  final Future<dynamic> Function(int page) load;

  /// the items of an answer, whether more come, and the total when the API says
  final FeedPage Function(Json answer, int page) parse;

  /// one item; [replace] puts a changed copy in its place (read, acknowledged)
  final Widget Function(BuildContext context, Json item, void Function(Json) replace) item;

  /// what stands above the items (a title, the filters), given the total once known
  final List<Widget> Function(int? total)? header;

  /// said when there is nothing at all
  final String empty;
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
      final p = widget.parse(asJson(answer), page);
      if (!mounted) return;
      final seen = {for (final x in _items) '${x['id']}'};
      setState(() {
        _items.addAll(p.items.where((x) => !seen.contains('${x['id']}')));
        _page = page;
        _more = p.more && p.items.isNotEmpty;
        _total = p.total ?? _total;
      });
      // a short first page that does not fill the screen: bring the next one too
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && _scroll.hasClients && _scroll.position.maxScrollExtent <= 0) _next();
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
    return RefreshIndicator(
      onRefresh: _refresh,
      child: ListView(
        controller: _scroll,
        padding: const EdgeInsets.all(Tokens.sp4),
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          if (_staleAt != null) ...[StaleLine(at: _staleAt!), const SizedBox(height: Tokens.sp3)],
          ...?widget.header?.call(_total),
          for (var i = 0; i < _items.length; i++)
            widget.item(context, _items[i], (changed) => setState(() => _items[i] = changed)),
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
                  OutlinedButton(
                    key: const Key('feedRetry'),
                    onPressed: _next,
                    child: Text(s.retry),
                  ),
                ],
              ),
            )
          else if (_items.isEmpty)
            EmptyLine(widget.empty)
          else if (_more)
            Center(
              child: TextButton(
                key: const Key('feedMore'),
                onPressed: _next,
                child: Text(s.pfMore),
              ),
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
        ],
      ),
    );
  }
}
