import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api_transport.dart';
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'common.dart';
import 'data.dart';

/// The School bus screen's words, in English and Hindi.
extension BusWords on S {
  String _b(String en, String hi) => hindi ? hi : en;

  String get busScreenHelp => _b(
    'The live bus, your child\'s transport and its history, and the taps from the bus reader.',
    'लाइव बस, आपके बच्चे का परिवहन और उसका इतिहास, और बस रीडर पर लगे टैप।',
  );
  String get busBusWord => _b('Bus', 'बस');
  String get busMonthlyFig => _b('A month', 'प्रति माह');
  String get busValidFig => _b('Valid until', 'कब तक मान्य');
  String get busTripsFig => _b('Trips this month', 'इस माह की यात्राएँ');
  String get busTapsTodayFig => _b('Bus taps today', 'आज बस में टैप');

  // the live bus
  String get busLiveTitle => _b('Live bus', 'लाइव बस');
  String get busUpdate => _b('Update', 'ताज़ा करें');
  String get busLastSeen => _b('Last seen', 'आख़िरी बार देखी गई');
  String get busJustNow => _b('just now', 'अभी');
  String busMinAgo(int n) => _b('$n min ago', '$n मिनट पहले');
  String get busSpeed => _b('Speed', 'गति');
  String busKmh(String n) => _b('$n km/h', '$n कि.मी./घंटा');
  String get busFromStop => _b('From your stop', 'आपके स्टॉप से');
  String busAboutKm(String n) => _b('About $n km', 'लगभग $n कि.मी.');
  String busAboutM(int n) => _b('About $n m', 'लगभग $n मीटर');
  String get busOpenMap => _b('Open in maps', 'मानचित्र में खोलें');
  String get busNoPosition =>
      _b('No position from the bus yet.', 'बस से अभी कोई स्थिति नहीं मिली।');
  String busUpcoming(String bus, String from) => _b(
    'Bus $bus runs this route from $from. Live tracking starts that day.',
    'बस $bus इस मार्ग पर $from से चलेगी। लाइव ट्रैकिंग उसी दिन से शुरू होगी।',
  );
  String get busNoneMapped => _b(
    'No bus is mapped to this route today; live tracking shows once the school maps one.',
    'आज इस मार्ग पर कोई बस तय नहीं है; विद्यालय के बस तय करते ही लाइव ट्रैकिंग दिखेगी।',
  );
  String busReplacementLine(String bus, String regular, String? until) => _b(
    'Replacement bus $bus runs this route in place of $regular${until == null ? '' : ' till $until'}.',
    'इस मार्ग पर $regular की जगह दूसरी बस $bus चल रही है${until == null ? '' : ' ($until तक)'}।',
  );
  String busDriverLine(String who) => _b('Driver: $who.', 'चालक: $who।');
  String get busStopsSame => _b('The stops and timings do not change.', 'स्टॉप और समय वही रहेंगे।');
  String busCallWho(String who) => _b('Call $who', '$who को कॉल करें');

  // the child's transport
  String get busTransportTitle => _b('Transport', 'परिवहन');
  String busService(String code) => switch (code) {
    'pick' => _b('Pick only', 'केवल पिक-अप'),
    'drop' => _b('Drop only', 'केवल ड्रॉप'),
    _ => _b('Pick and drop', 'पिक-अप और ड्रॉप'),
  };
  String busServiceHelp(String code) => switch (code) {
    'pick' => _b('Home to school', 'घर से विद्यालय'),
    'drop' => _b('School to home', 'विद्यालय से घर'),
    _ => _b('Home to school and back', 'घर से विद्यालय और वापस'),
  };
  String busAMonth(String money) => _b('$money a month', '$money प्रति माह');
  String busValidUntil(String month) =>
      _b('valid until the end of $month', '$month के अंत तक मान्य');
  String busPickLine(String what) => _b('Pick: $what', 'पिक-अप: $what');
  String busDropLine(String what) => _b('Drop: $what', 'ड्रॉप: $what');
  String get busStopsUntil => _b(
    'The route, the stoppage and the live bus position stay here until then.',
    'तब तक मार्ग, स्टॉप और लाइव बस की स्थिति यहाँ दिखती रहेगी।',
  );
  String get busNotOnBus => _b('Not on a bus this month.', 'इस माह बस सेवा नहीं ली है।');
  String get busIncharge => _b('Transport in-charge', 'परिवहन प्रभारी');
  String busFromMonth(String month) => _b('From $month', '$month से');
  String busWaitingWith(String who) => _b('Waiting with $who', '$who के पास लंबित');
  String get busTheSchool => _b('the school', 'विद्यालय');
  String get busCancelRequest => _b('Cancel this request', 'यह अनुरोध रद्द करें');
  String get busCancelAsk => _b(
    'Cancel this transport request? Nobody has decided it yet; the school will not act on it.',
    'यह परिवहन अनुरोध रद्द करें? इस पर अभी कोई निर्णय नहीं हुआ है; विद्यालय इस पर कार्रवाई नहीं करेगा।',
  );
  String get busCancelled => _b('Request cancelled.', 'अनुरोध रद्द किया गया।');
  String get busRequested => _b(
    'Request sent. The transport office and the fee department will approve it.',
    'अनुरोध भेज दिया गया। परिवहन कार्यालय और शुल्क विभाग इसे स्वीकृत करेंगे।',
  );
  String get busChangeOrStop => _b('Change or stop', 'बदलें या बंद करें');
  String get busApply => _b('Apply for transport', 'परिवहन के लिए आवेदन करें');
  String busHistoryN(int n) => _b('Transport history ($n)', 'परिवहन का इतिहास ($n)');
  String busPhase(String code) => switch (code) {
    'running' => _b('Riding now', 'अभी चल रहा'),
    'upcoming' => _b('To start', 'शुरू होना है'),
    'cancelled' => _b('Cancelled', 'रद्द'),
    _ => _b('Over', 'समाप्त'),
  };
  String busRequestsN(int n) => _b('Your requests ($n)', 'आपके अनुरोध ($n)');
  String busStatus(String code) => switch (code) {
    'pending' => _b('Pending', 'लंबित'),
    'approved' => _b('Approved', 'स्वीकृत'),
    'rejected' => _b('Rejected', 'अस्वीकृत'),
    _ => _b('Cancelled', 'रद्द'),
  };
  String busKind(String code) => switch (code) {
    'change' => _b('Change', 'बदलाव'),
    'leave' => _b('Withdrawal', 'परिवहन बंद'),
    _ => _b('New transport', 'नया परिवहन'),
  };
  String busWhatLeave(String month) => _b('Stop the bus from $month', '$month से बस बंद');
  String busMonthSpan(String from, String to) => _b('$from to $to', '$from से $to तक');
  String busAskedOn(String d) => _b('Asked on $d', '$d को अनुरोध किया');

  // the taps from the bus reader
  String get busTodayTitle => _b('Today on the bus', 'आज बस में');
  String get busTapsHelp => _b(
    'From the bus reader over the last seven days. You get a WhatsApp alert for each tap unless you '
        'withdraw the transport consent in your profile.',
    'पिछले सात दिनों में बस रीडर से। हर टैप पर आपको WhatsApp संदेश मिलता है, जब तक आप अपनी प्रोफ़ाइल में '
        'परिवहन की सहमति वापस नहीं लेते।',
  );
  String get busNoTapsToday => _b('No taps today yet.', 'आज अभी कोई टैप नहीं।');
  String get busNoTapsWeek =>
      _b('No bus taps in the last week.', 'पिछले सप्ताह बस में कोई टैप नहीं।');
  String busEarlierN(int n) => _b('Earlier this week ($n)', 'इस सप्ताह पहले ($n)');
  String get busBoarded => _b('Boarded', 'बस में चढ़े');
  String get busGotOff => _b('Got off', 'बस से उतरे');
  String get busTapPlace => _b('Open the place in maps', 'जगह मानचित्र में खोलें');

  // the request form
  String get busApplyTitle => _b('Transport request', 'परिवहन अनुरोध');
  String get busApplyHelp => _b(
    'The transport in-charge and then the fee department approve the request. The transport fee '
        'follows the approval.',
    'अनुरोध पहले परिवहन प्रभारी और फिर शुल्क विभाग स्वीकृत करते हैं। स्वीकृति के बाद परिवहन शुल्क लगता है।',
  );
  String get busAskOffice => _b(
    'Please ask the transport office to make this request for your child.',
    'कृपया अपने बच्चे के लिए यह अनुरोध परिवहन कार्यालय से करवाएँ।',
  );
  String get busNoRoutes => _b(
    'The school has not published its bus routes yet.',
    'विद्यालय ने अभी अपने बस मार्ग प्रकाशित नहीं किए हैं।',
  );
  String get busWhatToDo => _b('What do you want to do?', 'आप क्या करना चाहते हैं?');
  String get busDoChange =>
      _b('Change the route, stoppage or service', 'मार्ग, स्टॉप या सेवा बदलें');
  String get busDoLeave => _b('Stop the transport (withdrawal)', 'परिवहन बंद करें');
  String get busServiceLabel => _b('Service', 'सेवा');
  String get busPickRoute => _b('Pick route', 'पिक-अप का मार्ग');
  String get busDropRoute => _b('Drop route', 'ड्रॉप का मार्ग');
  String get busPickStop => _b('Pick stoppage', 'पिक-अप का स्टॉप');
  String get busDropStop => _b('Drop stoppage', 'ड्रॉप का स्टॉप');
  String get busRouteFirst => _b('Choose the route first', 'पहले मार्ग चुनें');
  String get busNoSlab => _b('no slab', 'कोई स्लैब नहीं');
  String get busOtherDrop =>
      _b('The drop is at a different stoppage or route', 'ड्रॉप किसी दूसरे स्टॉप या मार्ग पर है');
  String get busFromLabel => _b('From month', 'किस माह से');
  String get busLeaveFromLabel => _b('No transport from (month)', 'किस माह से परिवहन नहीं');
  String get busToLabel => _b('To month', 'किस माह तक');
  String busLeaveHelp(String month) => _b(
    'The bus, its fee and the live bus position stay until the month before $month; no transport '
        'fee is charged from that month.',
    'बस, उसका शुल्क और लाइव बस की स्थिति $month से पहले वाले माह तक रहेंगे; उस माह से परिवहन शुल्क नहीं '
        'लगेगा।',
  );
  String busSlabMissing(String stop) => _b(
    'The stoppage "$stop" has no fee slab yet. Please ask the transport office.',
    'स्टॉप "$stop" का अभी कोई शुल्क स्लैब नहीं है। कृपया परिवहन कार्यालय से पूछें।',
  );

  /// `Slab A` from the slab's name `A` (a name that already says "slab" is left as it is).
  String busSlab(String name) => name.toLowerCase().startsWith('slab') || name.startsWith('स्लैब')
      ? name
      : _b('Slab $name', 'स्लैब $name');
  String busQuote(String slab, String money) =>
      _b('$slab · monthly charge $money', '$slab · मासिक शुल्क $money');
  String busRulePick(String pct) =>
      _b('Pick only: $pct% of the slab', 'केवल पिक-अप: स्लैब का $pct%');
  String busRuleDrop(String pct) =>
      _b('Drop only: $pct% of the slab', 'केवल ड्रॉप: स्लैब का $pct%');
  String get busRuleSlab => _b('The slab of the stoppage', 'स्टॉप का स्लैब');
  String get busRulePickSlab => _b('The slab of the pick stoppage', 'पिक-अप स्टॉप का स्लैब');
  String busRuleSum(String pct) => _b('$pct% of each slab, added', 'हर स्लैब का $pct%, जोड़कर');
  String get busRuleHigher => _b('The higher of the two slabs', 'दोनों में से ऊँचा स्लैब');
  String get busChooseToSee => _b(
    'Choose the route and the stoppage to see the slab and the monthly charge.',
    'स्लैब और मासिक शुल्क देखने के लिए मार्ग और स्टॉप चुनें।',
  );
  String get busChoosePick =>
      _b('Choose the route and the stoppage for the pick.', 'पिक-अप के लिए मार्ग और स्टॉप चुनें।');
  String get busChooseDrop =>
      _b('Choose the route and the stoppage for the drop.', 'ड्रॉप के लिए मार्ग और स्टॉप चुनें।');
}

EduProApi _api(Ref ref) => ref.read(apiProvider);

/// One part of the screen: its answer, or the API's refusal (no network: thrown, so the copy kept is shown).
Future<(Object?, ApiException?)> _part(Future<dynamic> Function() load) async {
  try {
    final Object? v = await load();
    return (v, null);
  } on ApiException catch (e) {
    if (e.offline) rethrow;
    return (null, e);
  }
}

/// The child's school bus, as the website's Transport page reads it: the taps from the bus reader over the last
/// week, the transport (now, next, history, requests, the in-charge) and the live bus. A refusal of the transport or
/// the live bus leaves that part out (as on the website); a refusal of the taps means the account sees no child.
/// `{denied, canApply, mine, track, taps}` (each of the last three: the child's entry, or null).
final busTransportProvider = FutureProvider.autoDispose.family<Loaded<Json>, Profile>((
  ref,
  p,
) async {
  final r = await cached('busTransport:${p.id}', () async {
    final api = _api(ref);
    final parts = await Future.wait([
      _part(api.busMine),
      _part(api.transportRequestsMine),
      _part(api.gpsMine),
    ]);
    final (taps, refused) = parts[0];
    if (refused != null) {
      if (refused.status == 403) return {'denied': true};
      throw refused;
    }
    return {'taps': taps, 'mine': parts[1].$1, 'track': parts[2].$1};
  });
  final j = asJson(r.data);
  final mine = asJson(j['mine']);
  return Loaded<Json>(
    {
      'denied': j['denied'] == true,
      'canApply': mine['canApply'] == true,
      'mine': childIn(mine['children'], p),
      'track': childIn(asJson(j['track'])['children'], p),
      'taps': childIn(asJson(j['taps'])['children'], p),
    },
    r.at,
    stale: r.stale,
  );
});

/// What a transport request may ask for the child: the routes with their stoppages and slabs, the months, the
/// school's charging rule, whether the child rides now (a change or a withdrawal) and whether a family may ask.
final busOptionsProvider = FutureProvider.autoDispose.family<Loaded<Json>, Profile>((ref, p) async {
  final r = await cached(
    'busOptions:${p.id}',
    () => _api(ref).transportRequestsMineOptions(studentId: p.studentId ?? ''),
  );
  return Loaded(asJson(r.data), r.at, stale: r.stale);
});

/// Opens a map, or calls a number, with the phone's own app (a test puts its own in).
final busLinkProvider = Provider<Future<bool> Function(Uri)>(
  (ref) =>
      (u) => launchUrl(
        u,
        mode: u.scheme == 'https' ? LaunchMode.externalApplication : LaunchMode.platformDefault,
      ),
);

/// A place on the phone's maps app (Google Maps opens it; any browser otherwise).
Uri busMapUri(Object? lat, Object? lng) =>
    Uri.https('www.google.com', '/maps/search/', {'api': '1', 'query': '$lat,$lng'});

String _txt(Object? v) => v == null ? '' : '$v';

/// The non-empty parts, with dots between.
String _join(List<Object?> xs) => xs.map(_txt).where((x) => x.isNotEmpty).join(' · ');

/// `Nov 2026` from `2026-11`.
String _mon(S s, Object? m) {
  final d = DateTime.tryParse('${_txt(m)}-01');
  return d == null ? _txt(m) : '${s.monthShort(d)} ${d.year}';
}

String _clock(DateTime t) =>
    '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

/// 60 from 60.0, 62.5 as it is.
String _num(num n) => n == n.roundToDouble() ? '${n.round()}' : '$n';

/// `Gandhi Nagar gate (R1 North loop)`
String _stopAt(Object? stop, Object? route) =>
    _txt(route).isEmpty ? _txt(stop) : '${_txt(stop)} (${_txt(route)})';

/// How a period rides: `Pick: Gandhi Nagar gate · R1 North loop · 07:25` (and the drop).
List<String> _rides(S s, Json p) => [
  if (p['service'] != 'drop' && _txt(p['pickStop']).isNotEmpty)
    s.busPickLine(_join([p['pickStop'], p['pickRoute'], p['pickTime']])),
  if (p['service'] != 'pick' && _txt(p['dropStop']).isNotEmpty)
    s.busDropLine(_join([p['dropStop'], p['dropRoute'], p['dropTime']])),
];

/// What a request asks, on one line (the API's own line is in English only).
String _what(S s, Json r) {
  if (r['kind'] == 'leave') return s.busWhatLeave(_mon(s, r['fromMonth']));
  final service = _txt(r['service']).isEmpty ? 'both' : _txt(r['service']);
  final pick = _txt(r['pickStop']).isEmpty ? '' : _stopAt(r['pickStop'], r['pickRoute']);
  final drop = _txt(r['dropStop']).isEmpty ? '' : _stopAt(r['dropStop'], r['dropRoute']);
  // one stoppage says it all; pick and drop at two say which is which
  final where = switch (service) {
    'pick' => pick,
    'drop' => drop,
    _ =>
      pick == drop || drop.isEmpty
          ? pick
          : pick.isEmpty
          ? drop
          : '${s.busPickLine(pick)}, ${s.busDropLine(drop)}',
  };
  return _join([
    '${s.busService(service)}${where.isEmpty ? '' : ': $where'}',
    if (_txt(r['fromMonth']).isNotEmpty)
      s.busMonthSpan(_mon(s, r['fromMonth']), _mon(s, r['toMonth'])),
  ]);
}

Tone _phaseTone(String p) => switch (p) {
  'running' => Tone.success,
  'upcoming' => Tone.info,
  'cancelled' => Tone.danger,
  _ => Tone.neutral,
};

Tone _statusTone(String st) => switch (st) {
  'approved' => Tone.success,
  'rejected' => Tone.danger,
  'pending' => Tone.warning,
  _ => Tone.neutral,
};

/// Kilometres between two points (the bus and the child's stop); null when either is not known.
double? _km(Object? lat1, Object? lng1, Object? lat2, Object? lng2) {
  final a = [
    for (final x in [lat1, lng1, lat2, lng2]) double.tryParse(_txt(x)),
  ];
  if (a.any((x) => x == null)) return null;
  double rad(double d) => d * math.pi / 180;
  final dLat = rad(a[2]! - a[0]!);
  final dLng = rad(a[3]! - a[1]!);
  final h =
      math.pow(math.sin(dLat / 2), 2) +
      math.cos(rad(a[0]!)) * math.cos(rad(a[2]!)) * math.pow(math.sin(dLng / 2), 2);
  return 2 * 6371 * math.asin(math.sqrt(h));
}

/// The child's school bus as the website shows it (apps/parent/app/(app)/transport), on the phone's own screen:
/// the figures; the live bus (where it was last seen, how fast, how far from the stop, a replacement bus, a map);
/// the transport as approved (service, stoppages, slab and charge, until when, the in-charge to call, what comes
/// next), the request waiting (cancel it) or the form to ask for transport, a change or a withdrawal; the history
/// and the requests folded; and today's bus (the bus roll's morning and afternoon, the reader's taps) with the rest
/// of the week folded.
class TransportScreen extends ConsumerStatefulWidget {
  const TransportScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<TransportScreen> createState() => _TransportScreenState();
}

class _TransportScreenState extends ConsumerState<TransportScreen> {
  Profile get _p => widget.profile;
  String get _month => ym(DateTime.now());

  /// Says how it went (the list may be scrolled away from its top) and loads the screen again.
  void _done(String text) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(text)));
    ref.invalidate(busTransportProvider(_p));
  }

  Future<void> _refresh() {
    ref.invalidate(busRollProvider((_p, _month)));
    return ref.refresh(busTransportProvider(_p).future);
  }

  Future<void> _open(Uri u) async {
    final s = ref.read(stringsProvider);
    try {
      await ref.read(busLinkProvider)(u);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
      }
    }
  }

  Future<void> _cancel(Json r) async {
    final s = ref.read(stringsProvider);
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(s.busCancelAsk),
        actions: [
          TextButton(onPressed: () => Navigator.of(c).pop(false), child: Text(s.close)),
          FilledButton(
            key: const Key('busConfirmCancel'),
            onPressed: () => Navigator.of(c).pop(true),
            child: Text(s.busCancelRequest),
          ),
        ],
      ),
    );
    if (yes != true) return;
    try {
      await ref.read(apiProvider).transportRequestsCancel(id: '${r['id']}');
      _done(s.busCancelled);
    } catch (e) {
      _done(errorText(s, e));
    }
  }

  Future<void> _apply() async {
    final s = ref.read(stringsProvider);
    final sent = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => FamilyPage(
          title: s.busApplyTitle,
          child: BusApplyForm(profile: _p),
        ),
      ),
    );
    if (sent == true) _done(s.busRequested);
  }

  @override
  Widget build(BuildContext context) => LoadedList<Json>(
    value: ref.watch(busTransportProvider(_p)),
    refresh: _refresh,
    children: _view,
  );

  List<Widget> _view(Json d) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final mutedStyle = TextStyle(color: muted, fontSize: 14);
    final track = d['track'] is Map ? asJson(d['track']) : null;
    final mine = d['mine'] is Map ? asJson(d['mine']) : null;
    final taps = d['taps'] is Map ? asJson(d['taps']) : null;
    if (d['denied'] == true || (track == null && mine == null && taps == null)) {
      return [Notice(text: s.notLinked)];
    }
    final canApply = d['canApply'] == true;
    final current = mine?['current'] is Map ? asJson(mine!['current']) : null;
    final periods = asList(mine?['periods']);
    final requests = asList(mine?['requests']);
    final pending = requests.where((r) => r['status'] == 'pending').firstOrNull;
    final next = periods.where((x) => x['phase'] == 'upcoming').firstOrNull;
    final route = track?['route'] is Map ? asJson(track!['route']) : null;
    final vehicle = track?['vehicle'] is Map ? asJson(track!['vehicle']) : null;
    final events = asList(taps?['events']);
    final now = DateTime.now();
    final today = ymd(now);
    DateTime? at(Json e) => DateTime.tryParse(_txt(e['occurredAt']))?.toLocal();
    final todays = [
      for (final e in events)
        if (at(e) != null && ymd(at(e)!) == today) e,
    ];
    final earlier = [
      for (final e in events)
        if (!todays.contains(e)) e,
    ];
    final roll = ref.watch(busRollProvider((_p, _month))).value?.data;
    final rollSum = asJson(roll?['summary']);
    final rollToday = asList(roll?['days']).where((x) => '${x['date']}' == today).firstOrNull;
    final trips = ((rollSum['trips'] as num?) ?? 0).toInt();
    final routeCode = _txt(route?['code']).isNotEmpty
        ? _txt(route?['code'])
        : _txt(current?['pickRoute'] ?? current?['dropRoute']).split(' ').first;
    final bus = _txt(vehicle?['regNo']).isNotEmpty
        ? _txt(vehicle?['regNo'])
        : _txt(current?['vehicle']);

    return [
      FigureGrid(
        key: const Key('busFigures'),
        tiles: [
          FigureTile(
            label: s.route,
            value: routeCode.isEmpty ? '–' : routeCode,
            icon: Icons.alt_route,
          ),
          FigureTile(
            label: s.busBusWord,
            value: bus.isEmpty ? '–' : bus,
            icon: Icons.directions_bus_outlined,
          ),
          FigureTile(
            label: s.busMonthlyFig,
            value: current == null ? '–' : s.money(current['monthlyAmount']),
            icon: Icons.payments_outlined,
          ),
          FigureTile(
            label: s.busValidFig,
            value: current == null ? '–' : _mon(s, current['toMonth']),
            icon: Icons.event_outlined,
          ),
          FigureTile(
            label: s.busTripsFig,
            value: trips == 0 ? '–' : '${((rollSum['onBus'] as num?) ?? 0).toInt()}/$trips',
            icon: Icons.route_outlined,
          ),
          FigureTile(
            label: s.busTapsTodayFig,
            value: '${todays.length}',
            icon: Icons.contactless_outlined,
            tone: todays.isEmpty ? null : Tokens.statusSuccess,
          ),
        ],
      ),
      const SizedBox(height: Tokens.sp3),
      Text(s.busScreenHelp, style: mutedStyle),
      if (route != null) ..._live(s, mutedStyle, track!, route, vehicle),
      if (mine != null) ...[
        SectionTitle(s.busTransportTitle),
        _transportCard(s, mutedStyle, current, next, pending, canApply, mine),
        if (periods.isNotEmpty)
          Card(
            clipBehavior: Clip.antiAlias,
            child: ExpansionTile(
              key: const Key('busHistory'),
              leading: const Icon(Icons.history_outlined),
              title: Text(
                s.busHistoryN(periods.length),
                style: const TextStyle(fontWeight: Tokens.fwSemibold),
              ),
              shape: const Border(),
              collapsedShape: const Border(),
              expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
              children: [for (final x in periods) _periodRow(s, mutedStyle, x)],
            ),
          ),
        if (requests.isNotEmpty)
          Card(
            clipBehavior: Clip.antiAlias,
            child: ExpansionTile(
              key: const Key('busRequests'),
              leading: const Icon(Icons.assignment_outlined),
              title: Text(
                s.busRequestsN(requests.length),
                style: const TextStyle(fontWeight: Tokens.fwSemibold),
              ),
              shape: const Border(),
              collapsedShape: const Border(),
              expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
              children: [for (final r in requests) _requestRow(s, mutedStyle, r)],
            ),
          ),
      ],
      SectionTitle('${s.busTodayTitle} · ${s.dayShort(now)}', key: const Key('busTodayTitle')),
      Text(s.busTapsHelp, style: mutedStyle),
      const SizedBox(height: Tokens.sp2),
      if (rollToday != null) ...[
        Wrap(
          key: const Key('busRollToday'),
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp1,
          children: [
            for (final (part, code) in [
              (s.morning, rollToday['pick']),
              (s.afternoon, rollToday['drop']),
            ])
              code == null
                  ? StatusChip('$part: —', Tone.neutral)
                  : StatusChip('$part: ${s.busCode('$code')}', _rollTone('$code')),
          ],
        ),
        const SizedBox(height: Tokens.sp2),
      ],
      if (todays.isEmpty)
        EmptyLine(events.isEmpty ? s.busNoTapsWeek : s.busNoTapsToday)
      else
        Card(
          key: const Key('busToday'),
          child: Column(children: [for (final e in todays) _tapRow(s, mutedStyle, e, day: false)]),
        ),
      if (earlier.isNotEmpty)
        Card(
          clipBehavior: Clip.antiAlias,
          child: ExpansionTile(
            key: const Key('busEarlier'),
            leading: const Icon(Icons.contactless_outlined),
            title: Text(
              s.busEarlierN(earlier.length),
              style: const TextStyle(fontWeight: Tokens.fwSemibold),
            ),
            shape: const Border(),
            collapsedShape: const Border(),
            expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
            children: [for (final e in earlier) _tapRow(s, mutedStyle, e, day: true)],
          ),
        ),
    ];
  }

  Tone _rollTone(String code) => switch (code) {
    'P' => Tone.success,
    'A' => Tone.danger,
    'LV' => Tone.info,
    'GP' => Tone.warning,
    _ => Tone.neutral,
  };

  /// The live bus: the route and stop, a replacement bus, and where the bus was last seen.
  List<Widget> _live(S s, TextStyle muted, Json track, Json route, Json? vehicle) {
    final pos = track['position'] is Map ? asJson(track['position']) : null;
    final rep = track['replacement'] is Map ? asJson(track['replacement']) : null;
    final upcoming = track['upcoming'] is Map ? asJson(track['upcoming']) : null;
    final reg = _txt(vehicle?['regNo']);
    String seen(Json p) {
      final age = ((p['ageSeconds'] as num?) ?? 0).toInt();
      final when = DateTime.tryParse(_txt(p['recordedAt']))?.toLocal();
      final mins = (age / 60).round();
      if (when != null && mins > 90) return s.dateTime(when);
      return _join([mins < 1 ? s.busJustNow : s.busMinAgo(mins), if (when != null) _clock(when)]);
    }

    final speed = num.tryParse(_txt(pos?['speedKmh']));
    final km = pos == null ? null : _km(pos['lat'], pos['lng'], route['stopLat'], route['stopLng']);
    return [
      SectionTitle(
        s.busLiveTitle,
        action: TextButton.icon(
          key: const Key('busUpdate'),
          icon: const Icon(Icons.refresh),
          label: Text(s.busUpdate),
          onPressed: () => ref.invalidate(busTransportProvider(_p)),
        ),
      ),
      Card(
        key: const Key('liveBus'),
        child: Padding(
          padding: const EdgeInsets.all(Tokens.sp4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                _join([route['code'], route['name'], route['stop'], route['pickup']]),
                key: const Key('busRouteLine'),
                style: const TextStyle(fontWeight: Tokens.fwSemibold),
              ),
              if (rep != null) ...[
                const SizedBox(height: Tokens.sp2),
                _Box(
                  key: const Key('busReplacement'),
                  tone: Tone.warning,
                  child: Text(
                    [
                      s.busReplacementLine(
                        reg,
                        _txt(rep['regular']),
                        _txt(rep['until']).isEmpty ? null : s.date(rep['until']),
                      ),
                      if (_txt(rep['driver']).isNotEmpty)
                        // the number is on the call button under the box
                        s.busDriverLine(_txt(rep['driver'])),
                      s.busStopsSame,
                    ].join(' '),
                  ),
                ),
                if (_txt(rep['driverMobile']).isNotEmpty)
                  Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: _CallLink(
                      key: const Key('busCallDriver'),
                      name: _txt(rep['driver']).isEmpty
                          ? _txt(rep['driverMobile'])
                          : _txt(rep['driver']),
                      mobile: _txt(rep['driverMobile']),
                      open: _open,
                    ),
                  ),
              ],
              const SizedBox(height: Tokens.sp2),
              if (pos != null) ...[
                FactLine(s.busBusWord, reg.isEmpty ? _txt(pos['regNo']) : reg, strong: true),
                FactLine(s.busLastSeen, seen(pos)),
                if (speed != null) FactLine(s.busSpeed, s.busKmh(_num(speed.round()))),
                if (km != null)
                  FactLine(
                    s.busFromStop,
                    km < 1
                        ? s.busAboutM(((km * 1000 / 50).round() * 50).toInt())
                        : s.busAboutKm(km.toStringAsFixed(1)),
                  ),
                const SizedBox(height: Tokens.sp2),
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: OutlinedButton.icon(
                    key: const Key('busOpenMap'),
                    icon: const Icon(Icons.map_outlined),
                    label: Text(s.busOpenMap),
                    onPressed: () => _open(busMapUri(pos['lat'], pos['lng'])),
                  ),
                ),
              ] else
                Text(
                  vehicle != null
                      ? '$reg · ${s.busNoPosition}'
                      : upcoming != null
                      ? s.busUpcoming(_txt(upcoming['regNo']), s.date(upcoming['from']))
                      : s.busNoneMapped,
                  key: const Key('busNoPosition'),
                  style: muted,
                ),
            ],
          ),
        ),
      ),
    ];
  }

  /// The transport as approved now, the in-charge, what comes next, the request waiting and the way to ask.
  Widget _transportCard(
    S s,
    TextStyle muted,
    Json? current,
    Json? next,
    Json? pending,
    bool canApply,
    Json mine,
  ) {
    // cut short by a withdrawal: the bus stays until the end of that month
    final stops = current?['status'] == 'ended' && next == null;
    final incharge = asList(mine['incharge']);
    return Card(
      key: const Key('busTransport'),
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (current != null) ...[
              Text.rich(
                key: const Key('busCurrent'),
                TextSpan(
                  children: [
                    TextSpan(
                      text: s.busService(_txt(current['service'])),
                      style: const TextStyle(fontWeight: Tokens.fwBold),
                    ),
                    TextSpan(
                      text:
                          ' · ${_join([current['slab'], s.busAMonth(s.money(current['monthlyAmount']))])}'
                          ' · ${s.busValidUntil(_mon(s, current['toMonth']))}',
                    ),
                  ],
                ),
              ),
              for (final l in _rides(s, current))
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(_join([l, current['vehicle']]), style: muted),
                ),
              if (stops)
                Padding(
                  padding: const EdgeInsets.only(top: Tokens.sp1),
                  child: Text(s.busStopsUntil, style: muted),
                ),
            ] else
              Text(s.busNotOnBus, key: const Key('busNotOnBus')),
            if (incharge.isNotEmpty) ...[
              const SizedBox(height: Tokens.sp3),
              Text(s.busIncharge, style: muted),
              for (final (i, x) in incharge.indexed)
                Wrap(
                  spacing: Tokens.sp2,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    Text(_txt(x['name']), style: const TextStyle(fontWeight: Tokens.fwSemibold)),
                    if (_txt(x['mobile']).isNotEmpty)
                      _CallLink(
                        key: Key('busCall-$i'),
                        name: _txt(x['name']),
                        mobile: _txt(x['mobile']),
                        open: _open,
                      ),
                  ],
                ),
            ],
            if (next != null) ...[
              const SizedBox(height: Tokens.sp2),
              Text(
                '${s.busFromMonth(_mon(s, next['fromMonth']))}: '
                '${_join([s.busService(_txt(next['service'])), ..._rides(s, next), s.busAMonth(s.money(next['monthlyAmount']))])}',
                key: const Key('busNext'),
                style: muted,
              ),
            ],
            if (pending != null) ...[
              const SizedBox(height: Tokens.sp3),
              _Box(
                key: const Key('busPending'),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text.rich(
                      TextSpan(
                        children: [
                          TextSpan(
                            text: _txt(pending['number']),
                            style: const TextStyle(fontWeight: Tokens.fwBold),
                          ),
                          TextSpan(text: ' · ${_what(s, pending)}'),
                          if (pending['monthlyAmount'] != null)
                            TextSpan(text: ' · ${s.busAMonth(s.money(pending['monthlyAmount']))}'),
                        ],
                      ),
                    ),
                    const SizedBox(height: Tokens.sp1),
                    Text(
                      s.busWaitingWith(
                        _txt(pending['waitingOn']).isEmpty
                            ? s.busTheSchool
                            : _txt(pending['waitingOn']),
                      ),
                    ),
                  ],
                ),
              ),
              Align(
                alignment: AlignmentDirectional.centerEnd,
                child: OutlinedButton(
                  key: Key('busCancel-${pending['id']}'),
                  onPressed: () => _cancel(pending),
                  child: Text(s.busCancelRequest),
                ),
              ),
            ],
            if (canApply && pending == null) ...[
              const SizedBox(height: Tokens.sp3),
              FilledButton.icon(
                key: const Key('busApply'),
                icon: Icon(current != null || next != null ? Icons.swap_horiz : Icons.add),
                label: Text(current != null || next != null ? s.busChangeOrStop : s.busApply),
                onPressed: _apply,
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _periodRow(S s, TextStyle muted, Json p) {
    final phase = _txt(p['phase']);
    return Padding(
      key: Key('busPeriod-${p['id']}'),
      padding: const EdgeInsets.fromLTRB(Tokens.sp4, Tokens.sp2, Tokens.sp4, Tokens.sp3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp1,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(
                '${_mon(s, p['fromMonth'])} – ${_mon(s, p['toMonth'])}',
                style: const TextStyle(fontWeight: Tokens.fwBold),
              ),
              StatusChip(s.busPhase(phase), _phaseTone(phase)),
            ],
          ),
          Text(
            _join([
              s.busService(_txt(p['service'])),
              p['slab'],
              s.busAMonth(s.money(p['monthlyAmount'])),
            ]),
          ),
          for (final l in _rides(s, p)) Text(l, style: muted),
        ],
      ),
    );
  }

  Widget _requestRow(S s, TextStyle muted, Json r) {
    final status = _txt(r['status']);
    final asked = DateTime.tryParse(_txt(r['requestedAt']))?.toLocal();
    return Padding(
      key: Key('busRequest-${r['id']}'),
      padding: const EdgeInsets.fromLTRB(Tokens.sp4, Tokens.sp2, Tokens.sp4, Tokens.sp3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp1,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(
                _join([s.busKind(_txt(r['kind'])), r['number']]),
                style: const TextStyle(fontWeight: Tokens.fwBold),
              ),
              StatusChip(s.busStatus(status), _statusTone(status)),
            ],
          ),
          Text(_what(s, r)),
          Text(
            _join([
              if (asked != null) s.busAskedOn(s.date(asked)),
              if (r['monthlyAmount'] != null) s.busAMonth(s.money(r['monthlyAmount'])),
            ]),
            style: muted,
          ),
          if (status == 'pending')
            Text(
              s.busWaitingWith(
                _txt(r['waitingOn']).isEmpty ? s.busTheSchool : _txt(r['waitingOn']),
              ),
              style: muted,
            ),
          if (_txt(r['decisionNote']).isNotEmpty)
            Text(s.noteFromSchool(_txt(r['decisionNote'])), style: muted),
        ],
      ),
    );
  }

  /// A tap on the bus reader: when, the route, boarded or got off, and the place on the map.
  Widget _tapRow(S s, TextStyle muted, Json e, {required bool day}) {
    final at = DateTime.tryParse(_txt(e['occurredAt']))?.toLocal();
    final boarded = e['outcome'] == 'boarded';
    final where = _txt(e['lat']).isNotEmpty && _txt(e['lng']).isNotEmpty;
    return Padding(
      key: Key('busTap-${e['id']}'),
      padding: const EdgeInsets.fromLTRB(Tokens.sp4, Tokens.sp1, Tokens.sp1, Tokens.sp1),
      child: Row(
        children: [
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: Tokens.sp2),
              child: Wrap(
                spacing: Tokens.sp2,
                runSpacing: Tokens.sp1,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(
                    at == null ? '' : (day ? '${s.dayShort(at)} · ${_clock(at)}' : _clock(at)),
                    style: const TextStyle(fontWeight: Tokens.fwSemibold),
                  ),
                  if (_txt(e['route']).isNotEmpty) Text('${s.route} ${e['route']}', style: muted),
                  StatusChip(
                    boarded ? s.busBoarded : s.busGotOff,
                    boarded ? Tone.success : Tone.info,
                  ),
                ],
              ),
            ),
          ),
          if (where)
            IconButton(
              key: Key('busTapMap-${e['id']}'),
              tooltip: s.busTapPlace,
              icon: const Icon(Icons.place_outlined),
              onPressed: () => _open(busMapUri(e['lat'], e['lng'])),
            ),
        ],
      ),
    );
  }
}

/// A tinted box (body text on it: the tints stay light in dark mode too).
class _Box extends StatelessWidget {
  const _Box({super.key, required this.child, this.tone = Tone.info});
  final Widget child;
  final Tone tone;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(Tokens.sp3),
    decoration: BoxDecoration(
      color: (tone == Tone.warning ? Tokens.statusWarningBg : Tokens.statusInfoBg),
      borderRadius: BorderRadius.circular(Tokens.radiusSm),
    ),
    child: DefaultTextStyle.merge(
      style: const TextStyle(color: Tokens.textBody),
      child: child,
    ),
  );
}

/// A number to call from the phone (the in-charge, a replacement bus's driver).
class _CallLink extends ConsumerWidget {
  const _CallLink({super.key, required this.name, required this.mobile, required this.open});
  final String name;
  final String mobile;
  final Future<void> Function(Uri) open;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return Semantics(
      label: '${s.busCallWho(name)}: $mobile',
      button: true,
      excludeSemantics: true,
      child: TextButton.icon(
        style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: Tokens.sp1)),
        icon: const Icon(Icons.call_outlined, size: 18),
        label: Text(mobile),
        onPressed: () => open(Uri(scheme: 'tel', path: mobile.replaceAll(RegExp(r'[^0-9+]'), ''))),
      ),
    );
  }
}

/// The monthly charge for a way of riding, by the school's rule (the API works it out again on saving).
class _Quote {
  const _Quote({this.amount, this.slab, this.rule, this.missing});
  final num? amount;
  final String? slab;
  final String? rule;

  /// a stoppage with no fee slab
  final String? missing;
}

_Quote? _quoteOf(S s, Json settings, String service, Json? pick, Json? drop) {
  final pct = (settings['oneWayPercent'] as num?) ?? 100;
  num oneWay(num a) => (a * pct).round() / 100;
  for (final x in [pick, drop]) {
    if (x != null && x['amount'] == null) return _Quote(missing: _txt(x['name']));
  }
  num amt(Json x) => x['amount'] as num;
  String? slab(Json x) => x['slab']?.toString();
  if (service == 'pick' && pick != null) {
    return _Quote(amount: oneWay(amt(pick)), slab: slab(pick), rule: s.busRulePick(_num(pct)));
  }
  if (service == 'drop' && drop != null) {
    return _Quote(amount: oneWay(amt(drop)), slab: slab(drop), rule: s.busRuleDrop(_num(pct)));
  }
  if (service == 'both' && pick != null && drop != null) {
    if (pick['id'] == drop['id'] || amt(pick) == amt(drop)) {
      return _Quote(amount: amt(pick), slab: slab(pick), rule: s.busRuleSlab);
    }
    final rule = settings['twoStopRule'];
    if (rule == 'pick') {
      return _Quote(amount: amt(pick), slab: slab(pick), rule: s.busRulePickSlab);
    }
    final higher = amt(pick) >= amt(drop) ? pick : drop;
    if (rule == 'sum') {
      return _Quote(
        amount: oneWay(amt(pick)) + oneWay(amt(drop)),
        slab: slab(higher),
        rule: s.busRuleSum(_num(pct)),
      );
    }
    return _Quote(amount: amt(higher), slab: slab(higher), rule: s.busRuleHigher);
  }
  return null;
}

/// A transport request for the child, as the website's form (RideForm): a change or a withdrawal when the child
/// rides, the service (pick, drop or both), the route and the stoppage (each type to search; the stoppage brings its
/// slab and the monthly charge), a different drop, the months and a note. Pops `true` once sent.
class BusApplyForm extends ConsumerStatefulWidget {
  const BusApplyForm({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<BusApplyForm> createState() => _BusApplyFormState();
}

class _BusApplyFormState extends ConsumerState<BusApplyForm> {
  String? _kind;
  String _service = 'both';
  String? _pickRoute;
  String? _pickStop;
  String? _dropRoute;
  String? _dropStop;
  bool _otherDrop = false;
  String? _from;
  String? _to;
  final _note = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  /// The choices as they stand (the defaults follow the options: a change when riding, from next month to the
  /// session's end).
  ({
    String kind,
    List<String> months,
    String from,
    String to,
    bool needPick,
    bool needDrop,
    Json? pick,
    Json? drop,
  })
  _plan(Json o) {
    final months = [for (final m in (o['months'] as List? ?? const [])) '$m'];
    final thisMonth = _txt(o['thisMonth']);
    final kind = _kind ?? (o['riding'] == true ? 'change' : 'join');
    final next =
        months.where((m) => m.compareTo(thisMonth) > 0).firstOrNull ??
        months.where((m) => m.compareTo(thisMonth) >= 0).firstOrNull;
    final from = _from ?? next ?? months.firstOrNull ?? '';
    var to = _to ?? months.lastOrNull ?? '';
    if (to.compareTo(from) < 0) to = from;
    final leave = kind == 'leave';
    final needPick = !leave && _service != 'drop';
    final needDrop = !leave && (_service == 'drop' || (_service == 'both' && _otherDrop));
    final routes = asList(o['routes']);
    Json? stopOf(String? route, String? stop) =>
        asList(routes.where((r) => '${r['id']}' == route).firstOrNull?['stops'])
            .where((x) => '${x['id']}' == stop)
            .firstOrNull;
    final pick = needPick ? stopOf(_pickRoute, _pickStop) : null;
    final drop = needDrop ? stopOf(_dropRoute, _dropStop) : (_service == 'both' ? pick : null);
    return (
      kind: kind,
      months: months,
      from: from,
      to: to,
      needPick: needPick,
      needDrop: needDrop,
      pick: pick,
      drop: drop,
    );
  }

  Future<void> _send(Json o) async {
    final s = ref.read(stringsProvider);
    final p = _plan(o);
    final leave = p.kind == 'leave';
    if (!leave) {
      if (p.needPick && p.pick == null) return setState(() => _error = s.busChoosePick);
      if (p.needDrop && p.drop == null) return setState(() => _error = s.busChooseDrop);
      final q = _quoteOf(s, asJson(o['settings']), _service, p.pick, p.drop);
      if (q?.missing != null) return setState(() => _error = s.busSlabMissing(q!.missing!));
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final note = _note.text.trim();
    try {
      await ref
          .read(apiProvider)
          .transportRequestsCreate(
            body: ApplyDto(
              studentId: widget.profile.studentId ?? '',
              kind: p.kind,
              service: leave ? null : _service,
              pickRouteId: p.needPick ? _pickRoute : null,
              pickStopId: p.needPick ? _pickStop : null,
              dropRouteId: p.needDrop ? _dropRoute : null,
              dropStopId: p.needDrop ? _dropStop : null,
              fromMonth: p.from,
              toMonth: leave ? null : p.to,
              note: note.isEmpty ? null : note,
            ),
          );
      if (mounted) Navigator.of(context).pop(true);
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
  Widget build(BuildContext context) => LoadedList<Json>(
    value: ref.watch(busOptionsProvider(widget.profile)),
    refresh: () => ref.refresh(busOptionsProvider(widget.profile).future),
    children: _form,
  );

  List<Widget> _form(Json o) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = TextStyle(color: (dark ? Tokens.mobGray300 : Tokens.textMuted), fontSize: 14);
    final help = Text(s.busApplyHelp, style: muted);
    if (o['canApply'] != true) {
      return [help, const SizedBox(height: Tokens.sp3), Notice(text: s.busAskOffice)];
    }
    final routes = asList(o['routes']);
    if (routes.isEmpty) {
      return [help, const SizedBox(height: Tokens.sp3), Notice(text: s.busNoRoutes)];
    }
    final p = _plan(o);
    final leave = p.kind == 'leave';
    final quote = leave ? null : _quoteOf(s, asJson(o['settings']), _service, p.pick, p.drop);
    final head = Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: Tokens.fwSemibold);
    return [
      help,
      if (o['riding'] == true) ...[
        Padding(
          padding: const EdgeInsets.only(top: Tokens.sp4, bottom: Tokens.sp2),
          child: Semantics(header: true, child: Text(s.busWhatToDo, style: head)),
        ),
        Card(
          child: Column(
            children: [
              _choice('busKind-change', s.busDoChange, null, p.kind == 'change', () {
                setState(() => _kind = 'change');
              }),
              _choice('busKind-leave', s.busDoLeave, null, leave, () {
                setState(() => _kind = 'leave');
              }),
            ],
          ),
        ),
      ],
      if (!leave) ...[
        Padding(
          padding: const EdgeInsets.only(top: Tokens.sp4, bottom: Tokens.sp2),
          child: Semantics(header: true, child: Text(s.busServiceLabel, style: head)),
        ),
        Card(
          child: Column(
            children: [
              for (final v in const ['both', 'pick', 'drop'])
                _choice('busService-$v', s.busService(v), s.busServiceHelp(v), _service == v, () {
                  setState(() => _service = v);
                }),
            ],
          ),
        ),
        if (p.needPick) ..._side(s, routes, pick: true),
        if (_service == 'both')
          Padding(
            padding: const EdgeInsets.only(top: Tokens.sp2),
            child: CheckboxListTile(
              key: const Key('busOtherDrop'),
              value: _otherDrop,
              controlAffinity: ListTileControlAffinity.leading,
              contentPadding: EdgeInsets.zero,
              title: Text(s.busOtherDrop),
              onChanged: (v) => setState(() => _otherDrop = v ?? false),
            ),
          ),
        if (p.needDrop) ..._side(s, routes, pick: false),
      ],
      const SizedBox(height: Tokens.sp4),
      _menu(
        key: const Key('busFrom'),
        label: leave ? s.busLeaveFromLabel : s.busFromLabel,
        value: p.from,
        entries: [for (final m in p.months) (m, _mon(s, m))],
        onSelected: (v) => setState(() {
          _from = v;
          if (v != null && p.to.compareTo(v) < 0) _to = v;
        }),
      ),
      if (!leave) ...[
        const SizedBox(height: Tokens.sp3),
        KeyedSubtree(
          key: ValueKey('to:${p.from}'),
          child: _menu(
            key: const Key('busTo'),
            label: s.busToLabel,
            value: p.to,
            entries: [
              for (final m in p.months)
                if (m.compareTo(p.from) >= 0) (m, _mon(s, m)),
            ],
            onSelected: (v) => setState(() => _to = v),
          ),
        ),
      ],
      const SizedBox(height: Tokens.sp3),
      Semantics(
        liveRegion: true,
        child: KeyedSubtree(
          key: const Key('busQuote'),
          child: leave
              ? Text(s.busLeaveHelp(_mon(s, p.from)), style: muted)
              : quote?.missing != null
              ? ErrorText(s.busSlabMissing(quote!.missing!))
              : quote != null
              ? Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(
                        text: s.busQuote(s.busSlab(quote.slab ?? '—'), s.money(quote.amount)),
                        style: const TextStyle(fontWeight: Tokens.fwSemibold),
                      ),
                      TextSpan(text: ' · ${quote.rule}', style: muted),
                    ],
                  ),
                )
              : Text(s.busChooseToSee, style: muted),
        ),
      ),
      const SizedBox(height: Tokens.sp4),
      TextField(
        key: const Key('busNote'),
        controller: _note,
        maxLength: 300,
        decoration: InputDecoration(
          labelText: s.noteForSchool,
          border: const OutlineInputBorder(),
          counterText: '',
        ),
      ),
      const SizedBox(height: Tokens.sp3),
      if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp3)],
      FilledButton(
        key: const Key('busSend'),
        onPressed: _busy ? null : () => _send(o),
        child: Text(s.sendRequest),
      ),
    ];
  }

  /// One of a few choices (a radio row; the screen reader hears it as one of a group).
  Widget _choice(String key, String title, String? help, bool on, VoidCallback pick) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Semantics(
      inMutuallyExclusiveGroup: true,
      selected: on,
      child: ListTile(
        key: Key(key),
        leading: Icon(
          on ? Icons.radio_button_checked : Icons.radio_button_unchecked,
          color: (dark ? Tokens.mobCyan500 : Tokens.mobNavy800),
        ),
        title: Text(title),
        subtitle: help == null ? null : Text(help),
        onTap: pick,
      ),
    );
  }

  /// The route and the stoppage of the pick or of the drop (the stoppage list waits for the route).
  List<Widget> _side(S s, List<Json> routes, {required bool pick}) {
    final route = pick ? _pickRoute : _dropRoute;
    final stop = pick ? _pickStop : _dropStop;
    final stops = asList(routes.where((r) => '${r['id']}' == route).firstOrNull?['stops']);
    final which = pick ? 'Pick' : 'Drop';
    String stopLabel(Json x) => _join([
      x['name'],
      pick ? x['pickupTime'] : x['dropTime'],
      x['slab'] == null
          ? s.busNoSlab
          : '${x['slab']}${x['amount'] == null ? '' : ' ${s.money(x['amount'])}'}',
    ]);
    return [
      const SizedBox(height: Tokens.sp4),
      _menu(
        key: Key('bus${which}Route'),
        label: pick ? s.busPickRoute : s.busDropRoute,
        value: route,
        entries: [
          for (final r in routes)
            (
              '${r['id']}',
              '${_join([r['code'], r['name']])}${_txt(r['vehicle']).isEmpty ? '' : ' (${r['vehicle']})'}',
            ),
        ],
        onSelected: (v) => setState(() {
          if (pick) {
            _pickRoute = v;
            _pickStop = null;
          } else {
            _dropRoute = v;
            _dropStop = null;
          }
        }),
      ),
      const SizedBox(height: Tokens.sp3),
      // a new route: a new list of stoppages, nothing chosen
      KeyedSubtree(
        key: ValueKey('$which:$route'),
        child: _menu(
          key: Key('bus${which}Stop'),
          label: pick ? s.busPickStop : s.busDropStop,
          value: stop,
          enabled: route != null,
          helper: route == null ? s.busRouteFirst : null,
          entries: [for (final x in stops) ('${x['id']}', stopLabel(x))],
          onSelected: (v) => setState(() {
            if (pick) {
              _pickStop = v;
            } else {
              _dropStop = v;
            }
          }),
        ),
      ),
    ];
  }

  /// A list to choose from, typed to search.
  Widget _menu({
    required Key key,
    required String label,
    required String? value,
    required List<(String, String)> entries,
    required ValueChanged<String?> onSelected,
    bool enabled = true,
    String? helper,
  }) => DropdownMenu<String>(
    key: key,
    label: Text(label),
    enabled: enabled,
    helperText: helper,
    initialSelection: value,
    trailingIcon: dropArrow(label),
    selectedTrailingIcon: dropArrow(label, open: true),
    expandedInsets: EdgeInsets.zero,
    enableFilter: true,
    enableSearch: true,
    requestFocusOnTap: true,
    onSelected: onSelected,
    dropdownMenuEntries: [for (final (v, l) in entries) DropdownMenuEntry(value: v, label: l)],
  );
}
