import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'common.dart';
import 'data.dart';

/// The words of the gate passes (as the website's, in English and Hindi).
extension GateWords on S {
  String _g(String en, String hi) => hindi ? hi : en;

  String get gateTitle => _g('Early leave and late arrival', 'जल्दी छुट्टी और देर से आना');
  String gateCount(int n, bool filtered) =>
      '${filtered ? _g('$n found', '$n मिले') : _g('$n in all', 'कुल $n')} · ${_g('latest first', 'नवीनतम पहले')}';
  String get gateList => _g('List', 'सूची');
  String get gateCalendar => _g('Calendar', 'कैलेंडर');
  String get gateRequest => _g('Request a gate pass', 'गेट पास माँगें');
  String get gateAll => _g('All', 'सभी');
  String get gateOpenOnes => _g('Still to come', 'आने वाले');
  String get gatePastOnes => _g('Over or closed', 'पूरे या बंद');
  String get gateSearch =>
      _g('Pass number, reason or who collects', 'पास क्रमांक, कारण या कौन ले जाएगा');
  String get gateNone => _g(
    'No gate passes yet. Use Request a gate pass when your child must leave early or will come late.',
    'अभी कोई गेट पास नहीं। बच्चे को जल्दी जाना हो या देर से आना हो तो "गेट पास माँगें" चुनें।',
  );
  String get gateNoneMonth => _g('No gate passes in this month.', 'इस माह कोई गेट पास नहीं।');
  String gateKind(String k) => switch (k) {
    'late_arrival' => _g('Arriving late', 'देर से आना'),
    'hostel_home' => _g('Home leave (hostel)', 'घर की छुट्टी (छात्रावास)'),
    'hostel_outing' => _g('Outing (hostel)', 'बाहर जाना (छात्रावास)'),
    _ => _g('Leaving early', 'जल्दी जाना'),
  };
  String gateKindHelp(String k) => switch (k) {
    'late_arrival' => _g(
      'The child comes after school has started',
      'बच्चा स्कूल शुरू होने के बाद आएगा',
    ),
    'hostel_home' => _g(
      'You or someone you name collects the child from the hostel; back on a later day',
      'आप या आपका बताया व्यक्ति बच्चे को छात्रावास से ले जाएगा; किसी बाद के दिन वापसी',
    ),
    'hostel_outing' => _g(
      'The child goes out and comes back to the hostel the same day',
      'बच्चा बाहर जाकर उसी दिन छात्रावास लौटेगा',
    ),
    _ => _g(
      'Someone collects the child before school ends',
      'कोई स्कूल खत्म होने से पहले बच्चे को ले जाएगा',
    ),
  };
  String gateState(String state, String kind) => switch (state) {
    'pending' => _g('Waiting for the school', 'विद्यालय की प्रतीक्षा'),
    'approved' =>
      kind == 'early_leave'
          ? _g('Approved: collect at the front desk', 'स्वीकृत: फ्रंट डेस्क से लें')
          : kind == 'hostel_home'
          ? _g('Approved: collect from the hostel warden', 'स्वीकृत: छात्रावास वार्डन से लें')
          : _g('Approved', 'स्वीकृत'),
    'handed_over' =>
      kind == 'hostel_home'
          ? _g('Handed over at the hostel', 'छात्रावास में सौंपा गया')
          : _g('Handed over at the front desk', 'फ्रंट डेस्क पर सौंपा गया'),
    'out' =>
      kind == 'hostel_home' || kind == 'hostel_outing'
          ? _g('Out on leave', 'छुट्टी पर बाहर')
          : _g('Left the school', 'स्कूल से गया'),
    'returned' =>
      kind == 'hostel_home' || kind == 'hostel_outing'
          ? _g('Back in the hostel', 'छात्रावास लौट आया')
          : _g('Came in', 'आ गया'),
    'rejected' => _g('Not approved', 'स्वीकृत नहीं'),
    _ => _g('Cancelled', 'रद्द'),
  };
  String gateWith(String who) => _g('With $who', 'साथ: $who');
  String gateWaitingOn(String who) => _g('Waiting on $who', '$who के पास');
  String gateOut(String t) => _g('Gate out $t', 'गेट से बाहर $t');
  String gateIn(String t) => _g('Gate in $t', 'गेट से अंदर $t');
  String get gateDetails => _g('Details', 'विवरण');
  String get gateDetailsAndPass => _g('Details and gate pass', 'विवरण और गेट पास');
  String get gateCancel => _g('Cancel', 'रद्द करें');
  String get gateCancelAsk => _g('Cancel this gate pass?', 'क्या यह गेट पास रद्द करें?');
  String get gateKeep => _g('Keep it', 'रहने दें');
  String get gateCancelled => _g('Gate pass cancelled.', 'गेट पास रद्द किया गया।');
  String get gateRequestHelp => _g(
    'The school approves the request and sends you the pass. The child is handed over at the front desk.',
    'विद्यालय अनुरोध स्वीकृत करके आपको पास भेजता है। बच्चा फ्रंट डेस्क पर सौंपा जाता है।',
  );
  String get gateWhatFor => _g('What for', 'किसलिए');
  String get gateHostelOnly => _g(
    'Hostel leave is for children who board in the hostel.',
    'छात्रावास छुट्टी केवल छात्रावास में रहने वाले बच्चों के लिए है।',
  );
  String get gateDate => _g('Date', 'तारीख़');
  String get gateTimeLeaving => _g('Time of leaving', 'जाने का समय');
  String get gateTimeArriving => _g('Time of arriving', 'आने का समय');
  String get gateBackOn => _g('Back in the hostel on', 'छात्रावास वापसी की तारीख़');
  String get gateBackBy => _g('Back by (time)', 'वापसी का समय');
  String gateOutingBy(String t) => _g(
    'An outing comes back the same day, by $t. The warden and you are told if the child is late.',
    'बाहर जाना उसी दिन $t तक लौटता है। देर होने पर वार्डन और आपको बताया जाता है।',
  );
  String get gateLateTold => _g(
    'The warden and you are told if the child is late.',
    'देर होने पर वार्डन और आपको बताया जाता है।',
  );
  String get gateReason => _g('Reason', 'कारण');
  String get gateWho => _g('Who takes the child', 'बच्चे को कौन ले जाएगा');
  String gateRelation(String r) => switch (r) {
    'father' => _g('Father', 'पिता'),
    'mother' => _g('Mother', 'माता'),
    'guardian' => _g('Guardian', 'अभिभावक'),
    _ => r,
  };
  String get gateSomeoneElse => _g('Someone else', 'कोई और');
  String gateOtherHelp(bool hostel) => hostel
      ? _g(
          'For someone else, fill the three boxes below. At the hostel the warden sends a one-time code to your mobile before handing over the child.',
          'किसी और के लिए नीचे के तीन खाने भरें। छात्रावास में वार्डन बच्चा सौंपने से पहले आपके मोबाइल पर एक बार का कोड भेजेगा।',
        )
      : _g(
          'For someone else, fill the three boxes below. At the front desk the school sends a one-time code to your mobile before handing over the child.',
          'किसी और के लिए नीचे के तीन खाने भरें। फ्रंट डेस्क पर विद्यालय बच्चा सौंपने से पहले आपके मोबाइल पर एक बार का कोड भेजेगा।',
        );
  String get gateOtherName => _g('Name (someone else)', 'नाम (कोई और)');
  String get gateOtherRelation => _g('Relation to the child', 'बच्चे से संबंध');
  String get gateOtherMobile => _g('Mobile (someone else)', 'मोबाइल (कोई और)');
  String get gateSend => _g('Send the request', 'अनुरोध भेजें');
  String get gateNeedTime => _g('Choose the time.', 'समय चुनें।');
  String get gateNeedReturn => _g('Choose the day of coming back.', 'वापसी का दिन चुनें।');
  String get gateNeedReason =>
      _g('Write the reason (at least 3 letters).', 'कारण लिखें (कम से कम 3 अक्षर)।');
  String get gateNeedOther => _g(
    'Fill the name, relation and a 10-digit mobile of the person.',
    'उस व्यक्ति का नाम, संबंध और 10 अंकों का मोबाइल भरें।',
  );
  String get gateSent => _g(
    'Gate pass requested. The school will approve it and send you the pass.',
    'गेट पास माँगा गया। विद्यालय स्वीकृत करके आपको पास भेजेगा।',
  );
  String gatePassTitle(String number) => _g('Gate pass $number', 'गेट पास $number');
  String get gatePassCard => _g('Gate pass card (PDF)', 'गेट पास कार्ड (PDF)');
  String gateShowHelp(String kind, bool otp) => kind == 'early_leave'
      ? otp
            ? _g(
                'The person collecting shows the card at the front desk. The school sends a one-time code to your mobile: tell it to them only when the child is being handed over.',
                'ले जाने वाला व्यक्ति फ्रंट डेस्क पर कार्ड दिखाए। विद्यालय आपके मोबाइल पर एक बार का कोड भेजेगा: बच्चा सौंपे जाते समय ही उन्हें बताएँ।',
              )
            : _g(
                'The person collecting shows the card at the front desk; a photo is taken there and the gate lets the child out.',
                'ले जाने वाला व्यक्ति फ्रंट डेस्क पर कार्ड दिखाए; वहाँ फ़ोटो ली जाती है और गेट बच्चे को जाने देता है।',
              )
      : _g(
          'Show the card (its QR code) at the school gate.',
          'स्कूल गेट पर कार्ड (उसका QR कोड) दिखाएँ।',
        );
  String get gateChild => _g('Child', 'बच्चा');
  String get gatePassFor => _g('Pass for', 'पास किसलिए');
  String get gateWhen => _g('When', 'कब');
  String get gateBackByFact => _g('Back in the hostel by', 'छात्रावास वापसी तक');
  String get gateRequestedOn => _g('Requested on', 'माँगा गया');
  String get gateHandedOver => _g('Handed over at the front desk', 'फ्रंट डेस्क पर सौंपा');
  String get gateLeft => _g('Left the school', 'स्कूल से गया');
  String get gateCame => _g('Came in', 'आया');
  String get gateNote => _g('Note from the school', 'विद्यालय की टिप्पणी');
  String get gateApproval => _g('Approval by the school', 'विद्यालय की स्वीकृति');
  String gateLevel(String st) => switch (st) {
    'waiting' => _g('Waits its turn', 'बारी की प्रतीक्षा'),
    'pending' => _g('Deciding now', 'अभी निर्णय'),
    'approved' => _g('Approved', 'स्वीकृत'),
    'rejected' => _g('Rejected', 'अस्वीकृत'),
    _ => _g('Not needed', 'ज़रूरत नहीं'),
  };
  String gateAdmNo(String n) => _g('Adm. no. $n', 'प्रवेश क्र. $n');
}

Tone _stateTone(String st) => switch (st) {
  'pending' => Tone.warning,
  'approved' => Tone.success,
  'handed_over' => Tone.info,
  'rejected' => Tone.danger,
  _ => Tone.neutral,
};

Tone _levelTone(String st) => switch (st) {
  'pending' => Tone.warning,
  'approved' => Tone.success,
  'rejected' => Tone.danger,
  _ => Tone.neutral,
};

String _hm(TimeOfDay t) =>
    '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

String _clock(Object? iso) {
  final t = DateTime.tryParse('${iso ?? ''}')?.toLocal();
  return t == null ? '' : _hm(TimeOfDay.fromDateTime(t));
}

/// The child's gate passes: `(profile, state, words, page, from, to)` (empty: no filter; a month: from–to).
final gatePassesProvider = FutureProvider.autoDispose
    .family<Loaded<Json>, (Profile, String, String, int, String, String)>((ref, a) async {
      final (p, state, q, page, from, to) = a;
      final r = await cached(
        'gate:${p.id}:$state:$q:$page:$from:$to',
        () => ref
            .read(apiProvider)
            .gatePassMine(
              studentId: p.studentId,
              state: state.isEmpty ? null : state,
              q: q.isEmpty ? null : q,
              from: from.isEmpty ? null : from,
              to: to.isEmpty ? null : to,
              page: from.isEmpty ? page : null,
              size: from.isEmpty ? 10 : 100,
            ),
      );
      return Loaded(asJson(r.data), r.at, stale: r.stale);
    });

/// One gate pass in full.
final gatePassProvider = FutureProvider.autoDispose.family<Json, String>(
  (ref, id) async => asJson(await ref.read(apiProvider).gatePassMineGet(id: id)),
);

/// The gate passes as the website's page (apps/parent/app/(app)/gate-passes): a list with the status and a search,
/// ten a page, or a month; each with its date, kind, state, reason, who takes the child and the gate times;
/// Details and Cancel; Request a gate pass.
class GatePassesScreen extends ConsumerStatefulWidget {
  const GatePassesScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<GatePassesScreen> createState() => _GatePassesScreenState();
}

class _GatePassesScreenState extends ConsumerState<GatePassesScreen> {
  bool _calendar = false;
  String _state = '';
  String _q = '';
  int _page = 1;
  DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);
  final _words = TextEditingController();

  @override
  void dispose() {
    _words.dispose();
    super.dispose();
  }

  (Profile, String, String, int, String, String) get _key => _calendar
      ? (widget.profile, '', '', 1, ymd(_month), ymd(DateTime(_month.year, _month.month + 1, 0)))
      : (widget.profile, _state, _q, _page, '', '');

  Future<void> _request() async {
    final s = ref.read(stringsProvider);
    final id = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => FamilyPage(
          title: s.gateRequest,
          child: GatePassForm(profile: widget.profile),
        ),
      ),
    );
    if (!mounted) return;
    ref.invalidate(gatePassesProvider);
    if (id != null) openGatePass(context, widget.profile, id, sent: true);
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final filtered = _state.isNotEmpty || _q.isNotEmpty;
    return LoadedList<Json>(
      value: ref.watch(gatePassesProvider(_key)),
      refresh: () => ref.refresh(gatePassesProvider(_key).future),
      children: (d) {
        final passes = asList(d['data']);
        final total = ((asJson(d['page'])['total'] as num?) ?? passes.length).toInt();
        final pages = (total / 10).ceil();
        return [
          Text(
            s.gateTitle,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
          ),
          Text(
            _calendar ? '${s.month(_month)} · $total' : s.gateCount(total, filtered),
            key: const Key('gateCount'),
            style: TextStyle(color: muted, fontSize: 14),
          ),
          const SizedBox(height: Tokens.sp3),
          FilledButton.icon(
            key: const Key('requestGatePass'),
            icon: const Icon(Icons.add),
            label: Text(s.gateRequest),
            onPressed: _request,
          ),
          const SizedBox(height: Tokens.sp3),
          Semantics(
            label: s.gateTitle,
            container: true,
            explicitChildNodes: true,
            child: Wrap(
              spacing: Tokens.sp2,
              children: [
                for (final (v, label) in [(false, s.gateList), (true, s.gateCalendar)])
                  ChoiceChip(
                    key: Key('gateView-${v ? 'calendar' : 'list'}'),
                    label: Text(label),
                    selected: _calendar == v,
                    showCheckmark: false,
                    onSelected: (_) => setState(() => _calendar = v),
                  ),
              ],
            ),
          ),
          const SizedBox(height: Tokens.sp2),
          if (_calendar)
            Row(
              children: [
                IconButton(
                  key: const Key('gateMonthBack'),
                  tooltip: s.previous,
                  icon: const Icon(Icons.chevron_left),
                  onPressed: () => setState(() => _month = DateTime(_month.year, _month.month - 1)),
                ),
                Expanded(
                  child: Text(
                    s.month(_month),
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontWeight: Tokens.fwBold),
                  ),
                ),
                IconButton(
                  key: const Key('gateMonthNext'),
                  tooltip: s.next,
                  icon: const Icon(Icons.chevron_right),
                  onPressed: () => setState(() => _month = DateTime(_month.year, _month.month + 1)),
                ),
              ],
            )
          else
            Card(
              child: Padding(
                padding: const EdgeInsets.all(Tokens.sp3),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Wrap(
                      spacing: Tokens.sp2,
                      runSpacing: Tokens.sp2,
                      children: [
                        for (final (v, label) in [
                          ('', s.gateAll),
                          ('open', s.gateOpenOnes),
                          ('past', s.gatePastOnes),
                        ])
                          ChoiceChip(
                            key: Key('gateState-${v.isEmpty ? 'all' : v}'),
                            label: Text(label),
                            selected: _state == v,
                            showCheckmark: false,
                            onSelected: (_) => setState(() {
                              _state = v;
                              _page = 1;
                            }),
                          ),
                      ],
                    ),
                    const SizedBox(height: Tokens.sp2),
                    TextField(
                      key: const Key('gateSearch'),
                      controller: _words,
                      maxLength: 80,
                      textInputAction: TextInputAction.search,
                      decoration: InputDecoration(
                        labelText: s.gateSearch,
                        prefixIcon: const Icon(Icons.search),
                        border: const OutlineInputBorder(),
                        counterText: '',
                      ),
                      onSubmitted: (v) => setState(() {
                        _q = v.trim();
                        _page = 1;
                      }),
                    ),
                    if (filtered)
                      Align(
                        alignment: AlignmentDirectional.centerEnd,
                        child: TextButton(
                          key: const Key('gateClear'),
                          onPressed: () => setState(() {
                            _state = '';
                            _q = '';
                            _words.clear();
                            _page = 1;
                          }),
                          child: Text(s.clearDates),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          const SizedBox(height: Tokens.sp2),
          if (passes.isEmpty)
            EmptyLine(_calendar ? s.gateNoneMonth : (filtered ? s.nothingMatches : s.gateNone)),
          if (_calendar)
            for (final day in {for (final x in passes) '${x['onDate']}'}.toList()..sort()) ...[
              SectionTitle(s.dayShort(day)),
              for (final x in passes.where((x) => '${x['onDate']}' == day))
                GatePassCard(profile: widget.profile, pass: x),
            ]
          else
            for (final x in passes) GatePassCard(profile: widget.profile, pass: x),
          if (!_calendar && total > 10)
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                IconButton(
                  key: const Key('gatePrev'),
                  tooltip: s.previous,
                  icon: const Icon(Icons.chevron_left),
                  onPressed: _page > 1 ? () => setState(() => _page -= 1) : null,
                ),
                Flexible(child: Text(s.pageOf(_page, pages), textAlign: TextAlign.center)),
                IconButton(
                  key: const Key('gateNext'),
                  tooltip: s.next,
                  icon: const Icon(Icons.chevron_right),
                  onPressed: _page < pages ? () => setState(() => _page += 1) : null,
                ),
              ],
            ),
        ];
      },
    );
  }
}

/// Opens a gate pass in full in the app; `sent`: just requested.
void openGatePass(BuildContext context, Profile profile, String id, {bool sent = false}) {
  final s = ProviderScope.containerOf(context, listen: false).read(stringsProvider);
  pushPage(context, s.gateDetails, GatePassDetail(profile: profile, id: id, sent: sent));
}

/// Asks to cancel a gate pass and does it; true when cancelled.
Future<bool> cancelGatePass(BuildContext context, WidgetRef ref, String id) async {
  final s = ref.read(stringsProvider);
  final yes = await showDialog<bool>(
    context: context,
    builder: (c) => AlertDialog(
      content: Text(s.gateCancelAsk),
      actions: [
        TextButton(onPressed: () => Navigator.of(c).pop(false), child: Text(s.gateKeep)),
        FilledButton(
          key: const Key('confirmGateCancel'),
          onPressed: () => Navigator.of(c).pop(true),
          child: Text(s.gateCancel),
        ),
      ],
    ),
  );
  if (yes != true) return false;
  try {
    await ref.read(apiProvider).gatePassMineCancel(id: id, body: const PassCancelDto());
    ref.invalidate(gatePassesProvider);
    ref.invalidate(gatePassProvider(id));
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.gateCancelled)));
    }
    return true;
  } catch (e) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
    }
    return false;
  }
}

/// A gate pass in a list: the date block, the kind, its state, the reason, the number, who takes the child, the
/// approver it waits on and the gate times; Details (and the pass) and Cancel.
class GatePassCard extends ConsumerWidget {
  const GatePassCard({super.key, required this.profile, required this.pass});
  final Profile profile;
  final Json pass;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final x = pass;
    final id = '${x['id']}';
    final state = '${x['state']}';
    final kind = '${x['kind']}';
    final on = DateTime.tryParse('${x['onDate']}') ?? DateTime.now();
    final meta = [
      '${x['number'] ?? ''}',
      if (x['escortName'] != null)
        s.gateWith(
          '${x['escortName']}${x['escortRelation'] != null ? ' (${x['escortRelation']})' : ''}',
        ),
      if (state == 'pending' && x['waitingOn'] != null) s.gateWaitingOn('${x['waitingOn']}'),
      if (x['outAt'] != null) s.gateOut(_clock(x['outAt'])),
      if (x['inAt'] != null) s.gateIn(_clock(x['inAt'])),
    ].where((t) => t.isNotEmpty).join(' · ');
    return Card(
      key: Key('gatePass-$id'),
      child: InkWell(
        onTap: () => openGatePass(context, profile, id),
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
                    if (x['atTime'] != null)
                      Text(s.time('${x['atTime']}'), style: const TextStyle(fontSize: 12)),
                  ],
                ),
              ),
              const SizedBox(width: Tokens.sp3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Wrap(
                      spacing: Tokens.sp2,
                      runSpacing: Tokens.sp1,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(s.gateKind(kind), style: const TextStyle(fontWeight: Tokens.fwBold)),
                        StatusChip(s.gateState(state, kind), _stateTone(state)),
                      ],
                    ),
                    if ('${x['reason'] ?? ''}'.isNotEmpty) Text('${x['reason']}'),
                    if (meta.isNotEmpty) Text(meta, style: TextStyle(color: muted, fontSize: 13)),
                    Wrap(
                      children: [
                        TextButton(
                          key: Key('gateDetails-$id'),
                          onPressed: () => openGatePass(context, profile, id),
                          child: Text(x['passNo'] != null ? s.gateDetailsAndPass : s.gateDetails),
                        ),
                        if (state == 'pending' || state == 'approved')
                          TextButton(
                            key: Key('gateCancel-$id'),
                            onPressed: () => cancelGatePass(context, ref, id),
                            child: Semantics(
                              label: '${s.gateCancel} ${x['number'] ?? ''}',
                              excludeSemantics: true,
                              child: Text(s.gateCancel),
                            ),
                          ),
                      ],
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

/// Asking for a gate pass as on the website: what for (leaving early, arriving late, and for a boarder home leave or
/// an outing), the day and time, coming back (hostel), the reason, and who takes the child (a parent on record, or
/// someone else with a name, relation and mobile). Pops with the new pass's id.
class GatePassForm extends ConsumerStatefulWidget {
  const GatePassForm({super.key, required this.profile, this.kind});
  final Profile profile;

  /// what for, when the caller already knows (the hostel's Ask for home leave / an outing)
  final String? kind;

  @override
  ConsumerState<GatePassForm> createState() => _GatePassFormState();
}

final _gateOptionsProvider = FutureProvider.autoDispose<Json>(
  (ref) async => asJson(await ref.read(apiProvider).gatePassMineOptions()),
);

class _GatePassFormState extends ConsumerState<GatePassForm> {
  late String? _kind = widget.kind;
  DateTime _on = DateTime.now();
  TimeOfDay? _at;
  DateTime? _returnOn;
  TimeOfDay? _returnAt;
  String? _escort;
  final _reason = TextEditingController();
  final _name = TextEditingController();
  final _relation = TextEditingController();
  final _mobile = TextEditingController();
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    for (final c in [_reason, _name, _relation, _mobile]) {
      c.dispose();
    }
    super.dispose();
  }

  TimeOfDay? _parse(String? hm) {
    final m = RegExp(r'^(\d{1,2}):(\d{2})').firstMatch(hm ?? '');
    return m == null ? null : TimeOfDay(hour: int.parse(m[1]!), minute: int.parse(m[2]!));
  }

  Future<void> _send(Json student, String outingBy) async {
    final s = ref.read(stringsProvider);
    final kind = _kind!;
    final hostel = kind == 'hostel_home' || kind == 'hostel_outing';
    final escorted = kind == 'early_leave' || kind == 'hostel_home';
    if (_at == null) return setState(() => _error = s.gateNeedTime);
    if (kind == 'hostel_home' && _returnOn == null) {
      return setState(() => _error = s.gateNeedReturn);
    }
    if (_reason.text.trim().length < 3) return setState(() => _error = s.gateNeedReason);
    final other = escorted && _escort == 'other';
    if (other &&
        (_name.text.trim().isEmpty ||
            _relation.text.trim().isEmpty ||
            !RegExp(r'^[6-9]\d{9}$').hasMatch(_mobile.text.trim()))) {
      return setState(() => _error = s.gateNeedOther);
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final r = asJson(
        await ref
            .read(apiProvider)
            .gatePassMineApply(
              body: StudentPassDto(
                studentId: '${student['id']}',
                kind: kind,
                onDate: ymd(_on),
                atTime: _hm(_at!),
                returnOn: kind == 'hostel_home' ? ymd(_returnOn!) : null,
                returnAt: hostel
                    ? _hm(_returnAt ?? _parse(kind == 'hostel_outing' ? outingBy : '17:00')!)
                    : null,
                reason: _reason.text.trim(),
                escortKind: escorted ? _escort : null,
                escortName: other ? _name.text.trim() : null,
                escortRelation: other ? _relation.text.trim() : null,
                escortMobile: other ? _mobile.text.trim() : null,
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
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    return AsyncBody<Json>(
      value: ref.watch(_gateOptionsProvider),
      retry: () => ref.invalidate(_gateOptionsProvider),
      data: (o) {
        final student = asList(o['data'])
            .where((x) => '${x['id']}' == widget.profile.studentId)
            .firstOrNull;
        final outingBy = '${o['outingReturnBy'] ?? '18:00'}';
        if (student == null) return Center(child: EmptyLine(s.notLinked));
        final boarder = student['hostel'] != null;
        final kinds = [
          'early_leave',
          'late_arrival',
          if (boarder) 'hostel_home',
          if (boarder) 'hostel_outing',
        ];
        final kind = _kind;
        final hostel = kind == 'hostel_home' || kind == 'hostel_outing';
        final usable = kind != null && (!hostel || boarder);
        final escorted = kind == 'early_leave' || kind == 'hostel_home';
        final onRecord = asList(student['guardians'])
            .where((g) => const ['father', 'mother', 'guardian'].contains(g['relation']))
            .toList();
        _escort ??= onRecord.isEmpty ? 'other' : '${onRecord.first['relation']}';
        final today = DateTime.now();
        return ListView(
          padding: const EdgeInsets.all(Tokens.sp4),
          children: [
            Text(s.gateRequestHelp, style: TextStyle(color: muted, fontSize: 14)),
            SectionTitle(s.gateWhatFor),
            RadioGroup<String>(
              groupValue: kind,
              onChanged: (v) => setState(() {
                _kind = v;
                _error = null;
              }),
              child: Column(
                children: [
                  for (final k in kinds)
                    Card(
                      child: RadioListTile<String>(
                        key: Key('gateKind-$k'),
                        value: k,
                        title: Text(
                          s.gateKind(k),
                          style: const TextStyle(fontWeight: Tokens.fwSemibold),
                        ),
                        subtitle: Text(s.gateKindHelp(k)),
                      ),
                    ),
                ],
              ),
            ),
            if (kind != null && !usable) Notice(text: s.gateHostelOnly),
            if (usable) ...[
              const SizedBox(height: Tokens.sp3),
              Wrap(
                spacing: Tokens.sp2,
                runSpacing: Tokens.sp2,
                children: [
                  OutlinedButton.icon(
                    key: const Key('gateOn'),
                    icon: const Icon(Icons.event),
                    label: Text('${s.gateDate}: ${s.date(_on)}'),
                    onPressed: () async {
                      final d = await showDatePicker(
                        context: context,
                        initialDate: _on,
                        firstDate: DateTime(today.year, today.month, today.day),
                        lastDate: today.add(const Duration(days: 365)),
                      );
                      if (d != null) setState(() => _on = d);
                    },
                  ),
                  OutlinedButton.icon(
                    key: const Key('gateAt'),
                    icon: const Icon(Icons.schedule),
                    label: Text(
                      '${kind == 'late_arrival' ? s.gateTimeArriving : s.gateTimeLeaving}: ${_at == null ? '—' : _hm(_at!)}',
                    ),
                    onPressed: () async {
                      final t = await showTimePicker(
                        context: context,
                        initialTime: _at ?? const TimeOfDay(hour: 12, minute: 0),
                      );
                      if (t != null) setState(() => _at = t);
                    },
                  ),
                  if (kind == 'hostel_home')
                    OutlinedButton.icon(
                      key: const Key('gateReturnOn'),
                      icon: const Icon(Icons.event_available),
                      label: Text(
                        '${s.gateBackOn}: ${_returnOn == null ? '—' : s.date(_returnOn!)}',
                      ),
                      onPressed: () async {
                        final d = await showDatePicker(
                          context: context,
                          initialDate: _returnOn ?? _on,
                          firstDate: _on,
                          lastDate: _on.add(const Duration(days: 365)),
                        );
                        if (d != null) setState(() => _returnOn = d);
                      },
                    ),
                  if (hostel)
                    OutlinedButton.icon(
                      key: const Key('gateReturnAt'),
                      icon: const Icon(Icons.schedule),
                      label: Text(
                        '${s.gateBackBy}: ${_hm(_returnAt ?? _parse(kind == 'hostel_outing' ? outingBy : '17:00')!)}',
                      ),
                      onPressed: () async {
                        final t = await showTimePicker(
                          context: context,
                          initialTime:
                              _returnAt ?? _parse(kind == 'hostel_outing' ? outingBy : '17:00')!,
                        );
                        if (t == null) return;
                        // an outing comes back by the hostel's hour
                        final max = _parse(outingBy)!;
                        final late =
                            kind == 'hostel_outing' &&
                            t.hour * 60 + t.minute > max.hour * 60 + max.minute;
                        setState(() => _returnAt = late ? max : t);
                      },
                    ),
                ],
              ),
              if (hostel) ...[
                const SizedBox(height: Tokens.sp1),
                Text(
                  kind == 'hostel_outing' ? s.gateOutingBy(outingBy) : s.gateLateTold,
                  style: TextStyle(color: muted, fontSize: 13),
                ),
              ],
              const SizedBox(height: Tokens.sp3),
              TextField(
                key: const Key('gateReason'),
                controller: _reason,
                maxLength: 300,
                decoration: InputDecoration(
                  labelText: '${s.gateReason} *',
                  border: const OutlineInputBorder(),
                ),
              ),
              if (escorted) ...[
                SectionTitle(s.gateWho),
                Card(
                  child: RadioGroup<String>(
                    groupValue: _escort,
                    onChanged: (v) => setState(() => _escort = v),
                    child: Column(
                      children: [
                        for (final g in onRecord)
                          RadioListTile<String>(
                            key: Key('gateEscort-${g['relation']}'),
                            value: '${g['relation']}',
                            title: Text(
                              '${s.gateRelation('${g['relation']}')} · ${g['name'] ?? ''}',
                            ),
                          ),
                        RadioListTile<String>(
                          key: const Key('gateEscort-other'),
                          value: 'other',
                          title: Text(s.gateSomeoneElse),
                        ),
                      ],
                    ),
                  ),
                ),
                if (_escort == 'other') ...[
                  Text(
                    s.gateOtherHelp(kind == 'hostel_home'),
                    style: TextStyle(color: muted, fontSize: 13),
                  ),
                  const SizedBox(height: Tokens.sp2),
                  TextField(
                    key: const Key('gateOtherName'),
                    controller: _name,
                    maxLength: 120,
                    decoration: InputDecoration(
                      labelText: s.gateOtherName,
                      border: const OutlineInputBorder(),
                      counterText: '',
                    ),
                  ),
                  const SizedBox(height: Tokens.sp2),
                  TextField(
                    key: const Key('gateOtherRelation'),
                    controller: _relation,
                    maxLength: 60,
                    decoration: InputDecoration(
                      labelText: s.gateOtherRelation,
                      border: const OutlineInputBorder(),
                      counterText: '',
                    ),
                  ),
                  const SizedBox(height: Tokens.sp2),
                  TextField(
                    key: const Key('gateOtherMobile'),
                    controller: _mobile,
                    maxLength: 10,
                    keyboardType: TextInputType.phone,
                    decoration: InputDecoration(
                      labelText: s.gateOtherMobile,
                      border: const OutlineInputBorder(),
                      counterText: '',
                    ),
                  ),
                ],
              ],
              if (_error != null) ...[const SizedBox(height: Tokens.sp3), ErrorText(_error!)],
              const SizedBox(height: Tokens.sp4),
              FilledButton(
                key: const Key('gateSend'),
                onPressed: _busy ? null : () => _send(student, outingBy),
                child: Text(s.gateSend),
              ),
            ],
          ],
        );
      },
    );
  }
}

/// A gate pass in full as the website: its state; once approved, the pass card (with its QR code) to view or save
/// and how it is used; the details; Cancel while it waits or before it is used; and where the approval stands.
class GatePassDetail extends ConsumerWidget {
  const GatePassDetail({super.key, required this.profile, required this.id, this.sent = false});
  final Profile profile;
  final String id;

  /// just requested: say so
  final bool sent;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    return AsyncBody<Json>(
      value: ref.watch(gatePassProvider(id)),
      retry: () => ref.invalidate(gatePassProvider(id)),
      data: (p) {
        final state = '${p['state']}';
        final kind = '${p['kind']}';
        final hostel = kind == 'hostel_home' || kind == 'hostel_outing';
        final live = p['passCode'] != null && (state == 'approved' || state == 'handed_over');
        final returnBy = DateTime.tryParse('${p['returnBy'] ?? ''}')?.toLocal();
        String? at(Object? iso) {
          final t = DateTime.tryParse('${iso ?? ''}')?.toLocal();
          return t == null ? null : s.dateTime(t);
        }

        final facts = <(String, String?)>[
          (
            s.gateChild,
            [
              if (p['student'] != null) '${p['student']}',
              if (p['section'] != null) '${p['section']}',
              if (p['admissionNo'] != null) s.gateAdmNo('${p['admissionNo']}'),
            ].join(' · '),
          ),
          (s.gatePassFor, s.gateKind(kind)),
          (
            s.gateWhen,
            '${s.date(p['onDate'] ?? '')}${p['atTime'] != null ? ', ${s.time('${p['atTime']}')}' : ''}',
          ),
          (s.gateBackByFact, hostel && returnBy != null ? s.dateTime(returnBy) : null),
          (s.gateReason, p['reason'] as String?),
          (
            s.gateWho,
            p['escortName'] == null
                ? null
                : '${p['escortName']}${p['escortRelation'] != null ? ' (${p['escortRelation']})' : ''}',
          ),
          (s.gateRequestedOn, at(p['createdAt'])),
          (s.gateHandedOver, at(p['handoverAt'])),
          (s.gateLeft, at(p['outAt'])),
          (s.gateCame, at(p['inAt'])),
          (s.gateNote, (p['decisionNote'] ?? p['cancelReason']) as String?),
        ];
        return ListView(
          padding: const EdgeInsets.all(Tokens.sp4),
          children: [
            Text(
              s.gatePassTitle('${p['number'] ?? ''}'),
              style: TextStyle(color: muted, fontSize: 14),
            ),
            Text(
              [if (p['student'] != null) '${p['student']}', s.gateKind(kind)].join(' · '),
              style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: Tokens.fwBold),
            ),
            const SizedBox(height: Tokens.sp2),
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: StatusChip(s.gateState(state, kind), _stateTone(state)),
            ),
            if (sent) ...[
              const SizedBox(height: Tokens.sp3),
              Notice(key: const Key('gateSent'), text: s.gateSent),
            ],
            if (live) ...[
              SectionTitle(s.gatePassCard),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(Tokens.sp4),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              [
                                '${p['number'] ?? ''}',
                                s.gateKind(kind),
                                '${s.date(p['onDate'] ?? '')}${p['atTime'] != null ? ', ${s.time('${p['atTime']}')}' : ''}',
                              ].join(' · '),
                              style: const TextStyle(fontWeight: Tokens.fwSemibold),
                            ),
                          ),
                          FileIcons(
                            name: 'gateCard',
                            label: s.gatePassCard,
                            load: () => ref.read(apiProvider).gatePassMineCardJson(id: id),
                          ),
                        ],
                      ),
                      const SizedBox(height: Tokens.sp2),
                      Text(
                        s.gateShowHelp(kind, p['otpNeeded'] == true),
                        style: TextStyle(color: muted, fontSize: 13),
                      ),
                    ],
                  ),
                ),
              ),
            ],
            SectionTitle(s.gateDetails),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(Tokens.sp4),
                child: Column(
                  children: [
                    for (final (k, v) in facts)
                      if ((v ?? '').trim().isNotEmpty) FactLine(k, v!),
                  ],
                ),
              ),
            ),
            if (state == 'pending' || state == 'approved')
              Align(
                alignment: AlignmentDirectional.centerEnd,
                child: OutlinedButton(
                  key: const Key('gateDetailCancel'),
                  onPressed: () => cancelGatePass(context, ref, id),
                  child: Text(s.gateCancel),
                ),
              ),
            SectionTitle(s.gateApproval),
            Card(
              child: Column(
                children: [
                  for (final a in asList(p['approvals']).where((a) => a['status'] != 'skipped'))
                    ListTile(
                      key: Key('gateLevel-${a['seq']}'),
                      title: Text(
                        [
                          '${a['label'] ?? ''}',
                          if (a['actedBy'] != null) '${a['actedBy']}',
                          if (a['note'] != null) '${a['note']}',
                        ].join(' · '),
                      ),
                      subtitle: a['actedAt'] == null ? null : Text(at(a['actedAt'])!),
                      trailing: StatusChip(
                        s.gateLevel('${a['status']}'),
                        _levelTone('${a['status']}'),
                      ),
                    ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}
