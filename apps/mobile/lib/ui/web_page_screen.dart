import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../profiles/profiles.dart';
import 'widgets.dart';

/// The page's address inside the web app: a parent's page first picks their child (the web app's sibling switch).
String webTarget(Profile p, String to) => p.kind == 'parent' && p.studentId != null
    ? Uri(path: '/api/child', queryParameters: {'id': p.studentId, 'back': to}).toString()
    : to;

/// A one-time link (60 seconds) that opens the web app's page signed in as this phone (docs/design/89 §5.5).
final webLinkProvider = FutureProvider.autoDispose.family<String, (String, String)>((
  ref,
  args,
) async {
  final (app, to) = args;
  final p = (await ref.watch(profilesProvider.future)).current!;
  final r =
      await ref
              .read(apiProvider)
              .mobileAuthWebHandoff(
                body: MobileHandoffDto(app: app, to: webTarget(p, to)),
              )
          as Map;
  return '${r['url']}';
});

/// A web app page inside the app, for the screens that have no native one yet. With [doneWhen], the page closes
/// itself when the web app reaches an address it matches (the fee payment's return to `/fees?paid=`) and hands the
/// address back.
class WebPageScreen extends ConsumerStatefulWidget {
  const WebPageScreen({
    super.key,
    required this.app,
    required this.to,
    required this.title,
    this.doneWhen,
  });
  final String app;
  final String to;
  final String title;
  final bool Function(Uri url)? doneWhen;

  @override
  ConsumerState<WebPageScreen> createState() => _WebPageScreenState();
}

class _WebPageScreenState extends ConsumerState<WebPageScreen> {
  bool _done = false;

  void _watch(WebUri? url) {
    final u = url?.uriValue;
    if (_done || u == null || widget.doneWhen == null || !widget.doneWhen!(u)) return;
    _done = true;
    Navigator.of(context).pop(u);
  }

  @override
  Widget build(BuildContext context) {
    final link = ref.watch(webLinkProvider((widget.app, widget.to)));
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: AsyncBody<String>(
        value: link,
        retry: () => ref.invalidate(webLinkProvider((widget.app, widget.to))),
        data: (url) => InAppWebView(
          initialUrlRequest: URLRequest(url: WebUri(url)),
          initialSettings: InAppWebViewSettings(
            javaScriptEnabled: true,
            // the session is the web app's own cookie; nothing is cached for another person on this phone
            cacheEnabled: false,
            mediaPlaybackRequiresUserGesture: true,
            allowsInlineMediaPlayback: true,
          ),
          onUpdateVisitedHistory: (_, url, _) => _watch(url),
          onLoadStop: (_, url) => _watch(url),
        ),
      ),
    );
  }
}
