import 'dart:convert';

import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'common.dart';
import 'data.dart';

/// Online payment of fees in the app (docs/design/89, "Fees in the app"): the instalments ticked the oldest
/// first, the gateway and its convenience charge, then the gateway's own secure page — the only page the app
/// opens. The app starts the payment itself (`app: mobile`); the gateway returns to the school's registered
/// return address, which ends at /api/payments/mobile-done; the app closes there and reads the result.

/// One instalment of one fee (school or hostel) as the pay panel shows it.
class PayRow {
  const PayRow({
    required this.key,
    required this.label,
    required this.dueOn,
    required this.net,
    required this.paid,
    required this.balance,
    required this.lateFee,
    required this.status,
    required this.online,
  });

  factory PayRow.of(Json i) => PayRow(
    key: '${i['dueOn']}',
    label: '${i['label']}',
    dueOn: '${i['dueOn']}',
    net: _n(i['net']),
    paid: _n(i['paid']),
    balance: _n(i['balance']),
    lateFee: _n(asJson(i['lateFee'])['outstanding']),
    status: '${i['status']}',
    online: i['feePay'] != false,
  );

  final String key;
  final String label;
  final String dueOn;
  final double net;
  final double paid;
  final double balance;
  final double lateFee;

  /// paid · overdue · due · upcoming
  final String status;

  /// false: the class keeps this instalment off online payment (paid at the counter)
  final bool online;

  double get due => balance + lateFee;
}

double _n(Object? v) => double.tryParse('${v ?? 0}') ?? 0;

/// The rows of one fee of the child's ledger, in order (the ones the school shows).
List<PayRow> payRows(Json child, String ledger) => [
  for (final i in asList(child['instalments']))
    if ((i['ledger'] ?? 'school') == ledger && i['visible'] != false) PayRow.of(i),
];

/// The rows that can be paid online now, in order: a tick on one takes the earlier ones with it.
List<PayRow> openRows(List<PayRow> rows) => [
  for (final r in rows)
    if (r.online && r.due > 0) r,
];

/// Ticked to start with: everything due today (the last due or overdue row); -1 when nothing is.
int firstUpTo(List<PayRow> open) {
  var last = -1;
  for (var i = 0; i < open.length; i++) {
    if (open[i].status == 'overdue' || open[i].status == 'due') last = i;
  }
  return last;
}

/// What the ticked rows come to: every open row ticked pays exactly the ledger's own payable figure.
double feeFor(List<PayRow> open, int upTo, double payable) {
  if (upTo < 0) return 0;
  if (upTo == open.length - 1 && payable > 0) return payable;
  final sum = open.take(upTo + 1).fold<double>(0, (a, r) => a + r.due);
  return (sum * 100).round() / 100;
}

/// The gateway's convenience charge on an amount, as the API works it out (gateways.service chargeOn), so the
/// total shown is the total charged.
double chargeOn(double amount, Json gateway) {
  final pct = _n(gateway['chargePercent']);
  final flat = _n(gateway['chargeFlat']);
  return ((amount * pct / 100) * 100 + flat * 100).round() / 100;
}

/// "₹10 + 1.5%" (empty: no charge).
String chargeText(S s, Json g) => [
  if (_n(g['chargeFlat']) > 0) s.money(g['chargeFlat']),
  if (_n(g['chargePercent']) > 0) '${g['chargePercent']}%',
].join(' + ');

/// The pay panel of one fee: its instalments with a tick each, the gateways and the total with the charge.
class PayPanel extends ConsumerStatefulWidget {
  const PayPanel({
    super.key,
    required this.ledger,
    required this.rows,
    required this.payable,
    required this.gateways,
    required this.canPay,
    required this.onPay,
  });
  final String ledger;
  final List<PayRow> rows;

  /// the ledger's own payable figure (late fee included)
  final double payable;

  /// null: no online payment for this person; empty: no gateway for this fee
  final List<Json>? gateways;
  final bool canPay;
  final void Function(double amount, String gatewayId) onPay;

  @override
  ConsumerState<PayPanel> createState() => _PayPanelState();
}

class _PayPanelState extends ConsumerState<PayPanel> {
  late List<PayRow> _open = openRows(widget.rows);
  late int _upTo = firstUpTo(_open);
  String? _gw;

  @override
  void didUpdateWidget(PayPanel old) {
    super.didUpdateWidget(old);
    if (old.rows.length != widget.rows.length ||
        old.ledger != widget.ledger ||
        old.payable != widget.payable) {
      _open = openRows(widget.rows);
      _upTo = firstUpTo(_open);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    final gateways = widget.gateways ?? const <Json>[];
    final payNow = widget.canPay && widget.gateways != null && _open.isNotEmpty;
    final gwId = _gw ?? (gateways.isEmpty ? null : '${gateways.first['id']}');
    final chosen = gateways.where((g) => '${g['id']}' == gwId).firstOrNull;
    final fee = feeFor(_open, _upTo, widget.payable);
    final charge = chosen != null && fee > 0 ? chargeOn(fee, chosen) : 0.0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (payNow) ...[
          Text(s.oldestFirst, style: TextStyle(color: muted, fontSize: 14)),
          const SizedBox(height: Tokens.sp2),
        ],
        Card(
          child: Column(
            children: [
              for (var n = 0; n < widget.rows.length; n++)
                _row(context, s, widget.rows[n], payNow, last: n == widget.rows.length - 1),
            ],
          ),
        ),
        if (payNow) ...[
          if (gateways.isEmpty)
            Padding(
              padding: const EdgeInsets.only(top: Tokens.sp3),
              child: Notice(text: s.noGateway),
            )
          else ...[
            SectionTitle(s.payThrough),
            Card(
              child: Column(
                children: [
                  for (final g in gateways)
                    Semantics(
                      inMutuallyExclusiveGroup: true,
                      selected: '${g['id']}' == gwId,
                      child: ListTile(
                        key: Key('gateway-${widget.ledger}-${g['id']}'),
                        leading: Icon(
                          '${g['id']}' == gwId
                              ? Icons.radio_button_checked
                              : Icons.radio_button_unchecked,
                          color: dark ? Tokens.mobCyan500 : Tokens.mobNavy800,
                        ),
                        title: Text('${g['label']}'),
                        subtitle: Text(
                          chargeText(s, g).isEmpty
                              ? s.noCharge
                              : s.convenienceCharge(chargeText(s, g)),
                        ),
                        onTap: () => setState(() => _gw = '${g['id']}'),
                      ),
                    ),
                ],
              ),
            ),
          ],
          const SizedBox(height: Tokens.sp3),
          Container(
            padding: const EdgeInsets.all(Tokens.sp4),
            decoration: BoxDecoration(
              color: dark ? Tokens.mobNavy700 : Tokens.mobNavy50,
              borderRadius: BorderRadius.circular(Tokens.radiusLg),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(s.totalToPay, style: TextStyle(color: muted, fontSize: 14)),
                Semantics(
                  liveRegion: true,
                  child: Text(
                    s.money(fee + charge),
                    key: Key('payTotal-${widget.ledger}'),
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                ),
                if (charge > 0)
                  Text(
                    s.feePlusCharge(s.money(fee), s.money(charge)),
                    style: TextStyle(color: muted, fontSize: 14),
                  ),
                const SizedBox(height: Tokens.sp3),
                FilledButton.icon(
                  key: Key('pay-${widget.ledger}'),
                  icon: const Icon(Icons.lock_outline),
                  label: Text(fee > 0 ? s.payAmount(s.money(fee + charge)) : s.tickToPay),
                  onPressed: fee > 0 && chosen != null
                      ? () => widget.onPay(fee, '${chosen['id']}')
                      : null,
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _row(BuildContext context, S s, PayRow r, bool payNow, {required bool last}) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    // by the instalment, not the object: the screen makes new rows on every rebuild
    final i = _open.indexWhere((o) => o.key == r.key);
    final tickable = payNow && i >= 0;
    final ticked = tickable && i <= _upTo;
    void tick(bool on) => setState(() => _upTo = on ? i : i - 1);
    return MergeSemantics(
      child: InkWell(
        onTap: tickable ? () => tick(!ticked) : null,
        child: Container(
          decoration: BoxDecoration(
            color: ticked ? (dark ? Tokens.mobNavy700 : Tokens.mobCyan50) : null,
            border: last
                ? null
                : Border(bottom: BorderSide(color: dark ? Tokens.mobGray700 : Tokens.mobGray100)),
          ),
          padding: const EdgeInsets.fromLTRB(Tokens.sp1, Tokens.sp2, Tokens.sp4, Tokens.sp2),
          child: Row(
            children: [
              if (tickable)
                Checkbox(
                  key: Key('tick-${widget.ledger}-${r.key}'),
                  value: ticked,
                  onChanged: (v) => tick(v ?? false),
                  semanticLabel: s.payInstalment(r.label),
                )
              else
                const SizedBox(width: 48),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(r.label, style: const TextStyle(fontWeight: Tokens.fwBold, fontSize: 16)),
                    Text(
                      [
                        s.dueOn(s.date(r.dueOn)),
                        s.feeOf(s.money(r.net)),
                        if (r.paid > 0) s.paidOf(s.money(r.paid)),
                        if (r.lateFee > 0) s.lateFee(s.money(r.lateFee)),
                      ].join(' · '),
                      style: TextStyle(color: muted, fontSize: 14),
                    ),
                    if (!r.online && r.due > 0)
                      Text(s.counterOnly, style: TextStyle(color: muted, fontSize: 14)),
                  ],
                ),
              ),
              const SizedBox(width: Tokens.sp2),
              Flexible(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    StatusChip(s.instalmentStatus(r.status), instalmentTone(r.status)),
                    if (r.due > 0)
                      Text(
                        s.money(r.due),
                        style: const TextStyle(fontWeight: Tokens.fwBold, fontSize: 16),
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

Tone instalmentTone(String status) => switch (status) {
  'paid' => Tone.success,
  'overdue' => Tone.danger,
  'due' => Tone.warning,
  _ => Tone.neutral,
};

/// Starts a payment through the API (the app's own call) and opens the gateway; the result: '1' paid,
/// another outcome when it did not go through, null when the payer stopped.
Future<String?> payOnline(
  BuildContext context,
  WidgetRef ref,
  Future<dynamic> Function(EduProApi api) start,
) async {
  final s = ref.read(stringsProvider);
  try {
    final r = asJson(await start(ref.read(apiProvider)));
    if (!context.mounted) return null;
    return await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) =>
            CheckoutScreen(intent: asJson(r['intent']), checkout: asJson(r['checkout'])),
      ),
    );
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
    }
    return null;
  }
}

/// The paid value when [u] is the app's end of a payment (`/api/payments/mobile-done?paid=…`), else null.
String? paymentEnd(Uri? u) =>
    u != null && u.path == '/api/payments/mobile-done' ? (u.queryParameters['paid'] ?? '0') : null;

/// The address the gateway's page is opened from: the school's registered web address (where the payment
/// returns), so a gateway that checks where a payment comes from sees the same address as from the website.
String checkoutBase(Json intent) {
  final u = Uri.tryParse('${intent['returnUrl'] ?? ''}');
  return u == null || !u.hasScheme ? 'about:blank' : '${u.origin}/fees/pay';
}

String _esc(Object? v) => '${v ?? ''}'
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/// The few lines that hand the payer to the gateway (as the web app's checkout does): an auto-posted form
/// (PayU, CCAvenue, SBI ePay), the Razorpay checkout or Atom's — nothing of EduPro's web app.
String checkoutHtml(Json intent, Json checkout) {
  const style =
      '<style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#F7F9FB;color:#3B4757}'
      'main{max-width:480px;margin:32px auto;background:#fff;border-radius:16px;padding:24px}'
      'h1{font-size:20px;margin:0 0 8px;color:#00265D}button{background:#00A0C6;color:#00265D;border:0;'
      'border-radius:12px;padding:12px 18px;font-size:16px;font-weight:600}</style>';
  String page(String body, [String script = '']) =>
      '<!doctype html><html lang="en"><head><meta charset="utf-8">'
      '<meta name="viewport" content="width=device-width, initial-scale=1"><title>Pay</title>$style</head>'
      '<body><main>$body</main>$script</body></html>';
  final amount = _esc(intent['amount']);
  final txn = _esc(intent['txnId']);
  switch ('${checkout['kind']}') {
    case 'atom':
      // only Atom's own script address may be loaded
      final src = '${checkout['scriptUrl']}';
      final script =
          RegExp(r'^https://(pgtest|psa)\.atomtech\.in/staticdata/ots/js/atomcheckout\.js$')
              .hasMatch(src)
          ? src
          : '';
      final o = jsonEncode({
        'atomTokenId': checkout['atomTokenId'],
        'merchId': checkout['merchId'],
        'custEmail': checkout['custEmail'],
        'custMobile': checkout['custMobile'],
        'returnUrl': checkout['returnUrl'],
      }).replaceAll('<', '\\u003c');
      return page(
        '<h1>Paying ₹$amount</h1><p>Transaction $txn. The payment page opens now.</p>'
            '<p><button id="pay">Open the payment page</button></p>',
        '<script src="${_esc(script)}"></script><script>var o=$o;function go(){new AtomPaynetz(o,'
            '${jsonEncode('${checkout['env']}')})}document.getElementById("pay").onclick=go;go();</script>',
      );
    case 'razorpay':
      final o = jsonEncode({
        'key': checkout['keyId'],
        'amount': checkout['amount'],
        'currency': checkout['currency'],
        'order_id': checkout['orderId'],
        'name': checkout['name'],
        'description': checkout['description'],
        'prefill': checkout['prefill'],
        'notes': checkout['notes'],
        'callback_url': checkout['callbackUrl'],
        'redirect': true,
        'theme': {'color': '#00265D'},
      }).replaceAll('<', '\\u003c');
      return page(
        '<h1>Paying ₹$amount</h1><p>Transaction $txn. The Razorpay checkout opens now.</p>'
            '<p><button id="pay">Open the checkout</button></p>',
        '<script src="https://checkout.razorpay.com/v1/checkout.js"></script><script>var o=$o;'
            'var r=new Razorpay(o);document.getElementById("pay").onclick=function(){r.open()};r.open();</script>',
      );
    default:
      final fields = asJson(checkout['fields']).entries
          .map((e) => '<input type="hidden" name="${_esc(e.key)}" value="${_esc(e.value)}">')
          .join();
      return page(
        '<h1>Opening ${_esc(checkout['provider'])}</h1><p>₹$amount · transaction $txn.</p>'
            '<form id="gw" method="post" action="${_esc(checkout['action'])}">$fields'
            '<button type="submit">Continue to the payment page</button></form>',
        '<script>document.getElementById("gw").submit()</script>',
      );
  }
}

/// The gateway's own page inside the app (or, in development, the development gateway's two answers). It
/// closes itself at the app's end of the payment and hands back the result.
class CheckoutScreen extends ConsumerStatefulWidget {
  const CheckoutScreen({super.key, required this.intent, required this.checkout});
  final Json intent;
  final Json checkout;

  @override
  ConsumerState<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends ConsumerState<CheckoutScreen> {
  bool _done = false;
  bool _busy = false;

  void _finish(String? paid) {
    if (_done || !mounted) return;
    _done = true;
    Navigator.of(context).pop(paid);
  }

  Future<void> _stop() async {
    final s = ref.read(stringsProvider);
    final stop = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(s.cancelPayment),
        content: Text(s.cancelPaymentHelp),
        actions: [
          TextButton(onPressed: () => Navigator.of(c).pop(false), child: Text(s.keepPaying)),
          TextButton(
            key: const Key('stopPaying'),
            onPressed: () => Navigator.of(c).pop(true),
            child: Text(s.stopPaying),
          ),
        ],
      ),
    );
    if (stop == true) _finish(null);
  }

  /// The development gateway: the API signs and applies the chosen answer (only in mock mode).
  Future<void> _mock(String outcome) async {
    final s = ref.read(stringsProvider);
    setState(() => _busy = true);
    try {
      final r = asJson(
        await ref
            .read(apiProvider)
            .paymentsMock(
              body: MockPayDto(txnid: '${widget.intent['txnId']}', outcome: outcome),
            ),
      );
      _finish(r['status'] == 'succeeded' ? '1' : '${r['outcome'] ?? 'failed'}');
    } catch (e) {
      if (mounted) {
        setState(() => _busy = false);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
      }
    }
  }

  /// Gateway pages hand over to UPI apps (upi://, intent://…): those open outside the app.
  Future<NavigationActionPolicy> _navigate(Uri? u) async {
    final end = paymentEnd(u);
    if (end != null) {
      _finish(end);
      return NavigationActionPolicy.CANCEL;
    }
    if (u != null &&
        !const ['http', 'https', 'about', 'data', 'javascript', 'blob'].contains(u.scheme)) {
      try {
        await launchUrl(u, mode: LaunchMode.externalApplication);
      } catch (_) {
        // no app for it: the gateway's page offers another way
      }
      return NavigationActionPolicy.CANCEL;
    }
    return NavigationActionPolicy.ALLOW;
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final mock = widget.checkout['mode'] == 'mock';
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (popped, _) {
        if (!popped) _stop();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(s.paying),
          leading: IconButton(
            key: const Key('closeCheckout'),
            tooltip: s.close,
            icon: const Icon(Icons.close),
            onPressed: _stop,
          ),
        ),
        body: mock
            ? ListView(
                padding: const EdgeInsets.all(Tokens.sp5),
                children: [
                  Text(s.devGateway, style: Theme.of(context).textTheme.headlineSmall),
                  const SizedBox(height: Tokens.sp2),
                  Text(
                    s.devGatewayHelp(s.money(widget.intent['amount']), '${widget.intent['txnId']}'),
                  ),
                  const SizedBox(height: Tokens.sp5),
                  FilledButton(
                    key: const Key('mockSuccess'),
                    onPressed: _busy ? null : () => _mock('success'),
                    child: Text(s.paySuccess),
                  ),
                  const SizedBox(height: Tokens.sp3),
                  OutlinedButton(
                    key: const Key('mockFail'),
                    onPressed: _busy ? null : () => _mock('failure'),
                    child: Text(s.payFail),
                  ),
                ],
              )
            : InAppWebView(
                initialData: InAppWebViewInitialData(
                  data: checkoutHtml(widget.intent, widget.checkout),
                  baseUrl: WebUri(checkoutBase(widget.intent)),
                ),
                initialSettings: InAppWebViewSettings(
                  javaScriptEnabled: true,
                  useShouldOverrideUrlLoading: true,
                  // a payment page: nothing of it is kept on the phone
                  cacheEnabled: false,
                  incognito: true,
                  supportMultipleWindows: false,
                ),
                shouldOverrideUrlLoading: (_, action) => _navigate(action.request.url?.uriValue),
                onLoadStart: (_, url) {
                  final end = paymentEnd(url?.uriValue);
                  if (end != null) _finish(end);
                },
                onUpdateVisitedHistory: (_, url, _) {
                  final end = paymentEnd(url?.uriValue);
                  if (end != null) _finish(end);
                },
              ),
      ),
    );
  }
}
