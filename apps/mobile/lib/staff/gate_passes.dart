import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'data.dart';

/// The words of the staff gate passes (as the staff website's, in English and Hindi).
extension StaffGateWords on S {
  String _sg(String en, String hi) => hindi ? hi : en;

  String sgInboxTab(int n) => _sg('To approve · $n', 'स्वीकृति हेतु · $n');
  String get sgMineTab => _sg('My gate passes', 'मेरे गेट पास');
  String get sgApply => _sg('Apply for a gate pass', 'गेट पास के लिए आवेदन');
  String get sgApplyHelp => _sg(
    'RGP: you go out on work and come back the same day. NRGP: you do not come back today. List anything you carry out of the school.',
    'RGP: आप काम से बाहर जाकर उसी दिन लौटते हैं। NRGP: आप आज नहीं लौटते। विद्यालय से बाहर ले जाया जा रहा हर सामान लिखें।',
  );
  String get sgNothingWaits => _sg('Nothing waits for you.', 'आपकी प्रतीक्षा में कुछ नहीं।');
  String get sgNoneMine =>
      _sg('You have not asked for a gate pass yet.', 'आपने अभी कोई गेट पास नहीं माँगा।');
  String sgKind(String k) => switch (k) {
    'late_arrival' => _sg('Late arrival', 'देर से आना'),
    'rgp' => _sg('RGP · returnable', 'RGP · लौटने वाला'),
    'nrgp' => _sg('NRGP · non-returnable', 'NRGP · न लौटने वाला'),
    'hostel_home' => _sg('Hostel home leave', 'छात्रावास से घर की छुट्टी'),
    'hostel_outing' => _sg('Hostel outing', 'छात्रावास से बाहर जाना'),
    _ => _sg('Early leave', 'जल्दी जाना'),
  };
  String get sgBackBy => _sg('back by', 'वापसी');
  String sgWith(String who) => _sg('With $who', 'साथ: $who');
  String sgItems(int n) => _sg('$n item(s) carried out', '$n वस्तु बाहर ले जाई गई');
  String sgWaitingOn(String who) => _sg('Waiting on $who', '$who की प्रतीक्षा');
  String sgGateOut(String t) => _sg('Gate out $t', 'गेट से बाहर $t');
  String sgGateIn(String t) => _sg('Gate in $t', 'गेट से अंदर $t');
  String get sgNote => _sg('Note (needed to reject)', 'टिप्पणी (अस्वीकार हेतु आवश्यक)');
  String get sgApprove => _sg('Approve', 'स्वीकृत करें');
  String get sgReject => _sg('Reject', 'अस्वीकार करें');
  String get sgNeedNote => _sg('Write the reason to reject.', 'अस्वीकार करने का कारण लिखें।');
  String get sgApproved => _sg('Approved at your level.', 'आपके स्तर पर स्वीकृत।');
  String get sgRejected => _sg(
    'Rejected. The family or the employee has been told.',
    'अस्वीकृत। परिवार या कर्मचारी को बता दिया गया है।',
  );
  String get sgRequested => _sg(
    'Gate pass requested. It has gone for approval.',
    'गेट पास माँगा गया। यह स्वीकृति के लिए गया है।',
  );
  String get sgCancelled => _sg('Gate pass cancelled.', 'गेट पास रद्द।');
  String get sgCancelAsk => _sg('Cancel this gate pass?', 'यह गेट पास रद्द करें?');
  String get sgKeep => _sg('Keep it', 'रहने दें');
  String get sgCard => _sg('The pass (PDF)', 'पास (PDF)');
  String get sgType => _sg('Type of pass', 'पास का प्रकार');
  String get sgRgp => _sg('RGP · I come back today', 'RGP · मैं आज लौटूँगा');
  String get sgNrgp => _sg('NRGP · I do not come back today', 'NRGP · मैं आज नहीं लौटूँगा');
  String get sgDate => _sg('Date', 'तिथि');
  String get sgOutAt => _sg('Going out at', 'बाहर जाने का समय');
  String get sgBackAt => _sg('Back by', 'वापसी तक');
  String get sgPurpose => _sg('Purpose', 'उद्देश्य');
  String get sgGoingTo => _sg('Going to (optional)', 'कहाँ जा रहे हैं (वैकल्पिक)');
  String get sgItemsTitle =>
      _sg('Equipment or material taken out of the school', 'विद्यालय से बाहर ले जाया जा रहा सामान');
  String get sgNoItems => _sg(
    'Nothing carried out. Add a row for each item (laptop, projector, files…).',
    'कुछ बाहर नहीं ले जा रहे। हर सामान के लिए एक पंक्ति जोड़ें (लैपटॉप, प्रोजेक्टर, फ़ाइलें…)।',
  );
  String get sgRemove => _sg('Remove', 'हटाएँ');
  String sgRemoveItem(int n) => _sg('Remove item $n', 'वस्तु $n हटाएँ');
  String get sgNeedName => _sg(
    'Give each item a name, or remove the empty row.',
    'हर सामान का नाम लिखें, या खाली पंक्ति हटाएँ।',
  );
  String get sgChoose => _sg('Choose', 'चुनें');
  String sgItem(int n) => _sg('Item $n', 'वस्तु $n');
  String get sgQty => _sg('Quantity', 'मात्रा');
  String get sgSerial => _sg('Serial / asset no.', 'क्रमांक / संपत्ति संख्या');
  String get sgBringBack => _sg('To be brought back', 'वापस लाना है');
  String get sgAddItem => _sg('Add an item', 'वस्तु जोड़ें');
  String get sgSend => _sg('Send for approval', 'स्वीकृति के लिए भेजें');
  String get sgNeedOut => _sg('Choose the time you go out.', 'बाहर जाने का समय चुनें।');
  String get sgNeedBack => _sg('Say by when you will be back.', 'बताएँ कि आप कब तक लौटेंगे।');
  String get sgBackAfterOut => _sg(
    'The return time must be after the time out.',
    'वापसी का समय बाहर जाने के समय के बाद होना चाहिए।',
  );
  String get sgNeedPurpose =>
      _sg('Write the purpose (at least 3 letters).', 'उद्देश्य लिखें (कम से कम 3 अक्षर)।');
}

/// India time (HH:MM) of a moment the API gives.
String _istTime(Object? v) {
  final x = DateTime.tryParse('$v');
  if (x == null) return '';
  final t = x.toUtc().add(const Duration(hours: 5, minutes: 30));
  return '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
}

/// The return time, with its day when that is not the day the pass is for (hostel home leave).
String _backBy(S s, Json p) {
  final x = DateTime.tryParse('${p['returnBy']}');
  if (x == null) return '';
  final t = x.toUtc().add(const Duration(hours: 5, minutes: 30));
  final day = '${t.year}-${t.month.toString().padLeft(2, '0')}-${t.day.toString().padLeft(2, '0')}';
  return day == '${p['onDate']}'
      ? _istTime(p['returnBy'])
      : '${s.date(day)}, ${_istTime(p['returnBy'])}';
}

/// The passes waiting for my approval.
final staffGateInboxProvider = FutureProvider.autoDispose.family<Loaded<List<Json>>, Profile>((
  ref,
  p,
) async {
  final r = await cached('gate-inbox:${p.id}', () => ref.read(apiProvider).gatePassInbox());
  return Loaded(asList(asJson(r.data)['data']), r.at, stale: r.stale);
});

/// My own passes (RGP / NRGP), latest first.
final staffGateMineProvider = FutureProvider.autoDispose.family<Loaded<List<Json>>, Profile>((
  ref,
  p,
) async {
  final r = await cached('gate-mine:${p.id}', () => ref.read(apiProvider).gatePassStaff(size: 20));
  return Loaded(asList(asJson(r.data)['data']), r.at, stale: r.stale);
});

/// Gate passes as on the staff website (0069): **To approve** — the passes that wait on me (as class teacher,
/// coordinator, vice principal or principal), approve or reject with a note — and **My gate passes** — my own passes
/// to go out during school (RGP / NRGP): follow, cancel, the pass card, and apply. No web page.
class StaffGatePassesScreen extends ConsumerWidget {
  const StaffGatePassesScreen({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final waiting = ref.watch(staffGateInboxProvider(profile)).value?.data.length ?? 0;
    return DefaultTabController(
      length: 2,
      child: Column(
        children: [
          Material(
            color: Theme.of(context).colorScheme.surface,
            child: TabBar(
              key: const Key('sgTabs'),
              isScrollable: true,
              tabAlignment: TabAlignment.start,
              tabs: [
                Tab(text: s.sgInboxTab(waiting)),
                Tab(text: s.sgMineTab),
              ],
            ),
          ),
          Expanded(
            child: TabBarView(
              children: [
                _InboxTab(profile: profile),
                _MineTab(profile: profile),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

String _who(S s, Json p) => p['audience'] == 'student'
    ? [
        '${p['student'] ?? ''}${p['section'] != null ? ' (${p['section']})' : ''}',
        if (p['admissionNo'] != null) '${s.hindi ? 'प्रवेश सं.' : 'Adm. no.'} ${p['admissionNo']}',
      ].join(' · ')
    : ['${p['employee'] ?? ''}', if (p['employeeCode'] != null) '${p['employeeCode']}'].join(' · ');

/// When: the date, the time, back by — and the reason.
String _when(S s, Json p) => [
  '${s.date(p['onDate'] ?? '')}${p['atTime'] != null ? ', ${s.time('${p['atTime']}')}' : ''}',
  if (p['returnBy'] != null) '${s.sgBackBy} ${_backBy(s, p)}',
  '${p['reason'] ?? ''}',
].where((x) => x.isNotEmpty).join(' · ');

class _InboxTab extends ConsumerWidget {
  const _InboxTab({required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return LoadedList<List<Json>>(
      value: ref.watch(staffGateInboxProvider(profile)),
      refresh: () => ref.refresh(staffGateInboxProvider(profile).future),
      children: (rows) => [
        if (rows.isEmpty) Notice(text: s.sgNothingWaits),
        for (final p in rows) _InboxCard(profile: profile, pass: p),
      ],
    );
  }
}

class _InboxCard extends ConsumerStatefulWidget {
  const _InboxCard({required this.profile, required this.pass});
  final Profile profile;
  final Json pass;

  @override
  ConsumerState<_InboxCard> createState() => _InboxCardState();
}

class _InboxCardState extends ConsumerState<_InboxCard> {
  final _note = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _decide(String outcome) async {
    final s = ref.read(stringsProvider);
    final note = _note.text.trim();
    if (outcome == 'rejected' && note.isEmpty) {
      setState(() => _error = s.sgNeedNote);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .gatePassDecide(
            id: '${widget.pass['id']}',
            body: PassDecideDto(outcome: outcome, note: note.isEmpty ? null : note),
          );
      ref.invalidate(staffGateInboxProvider(widget.profile));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(outcome == 'approved' ? s.sgApproved : s.sgRejected)),
        );
      }
    } catch (e) {
      if (mounted) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final p = widget.pass;
    final id = '${p['id']}';
    final extra = [
      if (p['escortName'] != null)
        s.sgWith(
          '${p['escortName']}${p['escortRelation'] != null ? ' (${p['escortRelation']})' : ''}',
        ),
      if (p['destination'] != null) '${p['destination']}',
      if ((p['items'] as num? ?? 0) > 0) s.sgItems((p['items'] as num).toInt()),
    ];
    return Card(
      key: Key('sgInbox-$id'),
      margin: const EdgeInsets.only(bottom: Tokens.sp3),
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(_who(s, p), style: const TextStyle(fontWeight: Tokens.fwSemibold)),
                ),
                const SizedBox(width: Tokens.sp2),
                Flexible(child: Tag(s.sgKind('${p['kind']}'), color: Tokens.mobAmber50)),
              ],
            ),
            const SizedBox(height: Tokens.sp1),
            Text(_when(s, p)),
            if (extra.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: Tokens.sp1),
                child: Text(extra.join(' · '), style: TextStyle(color: muted, fontSize: 13)),
              ),
            const SizedBox(height: Tokens.sp2),
            TextField(
              key: Key('sgNote-$id'),
              controller: _note,
              maxLength: 300,
              decoration: InputDecoration(labelText: s.sgNote, counterText: ''),
            ),
            if (_error != null) ErrorText(_error!),
            const SizedBox(height: Tokens.sp2),
            Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp2,
              children: [
                FilledButton(
                  key: Key('sgApprove-$id'),
                  onPressed: _busy ? null : () => _decide('approved'),
                  child: Text(s.sgApprove),
                ),
                OutlinedButton(
                  key: Key('sgReject-$id'),
                  onPressed: _busy ? null : () => _decide('rejected'),
                  child: Text(s.sgReject),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _MineTab extends ConsumerWidget {
  const _MineTab({required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return LoadedList<List<Json>>(
      value: ref.watch(staffGateMineProvider(profile)),
      refresh: () => ref.refresh(staffGateMineProvider(profile).future),
      children: (rows) => [
        Align(
          alignment: Alignment.centerLeft,
          child: FilledButton.icon(
            key: const Key('sgApply'),
            icon: const Icon(Icons.add),
            label: Text(s.sgApply),
            onPressed: () => pushPage(context, s.sgApply, StaffGatePassForm(profile: profile)),
          ),
        ),
        const SizedBox(height: Tokens.sp3),
        if (rows.isEmpty) Notice(text: s.sgNoneMine),
        for (final p in rows) _MineCard(profile: profile, pass: p),
      ],
    );
  }
}

class _MineCard extends ConsumerWidget {
  const _MineCard({required this.profile, required this.pass});
  final Profile profile;
  final Json pass;

  Future<void> _cancel(BuildContext context, WidgetRef ref) async {
    final s = ref.read(stringsProvider);
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(s.sgCancelAsk),
        actions: [
          TextButton(onPressed: () => Navigator.of(c).pop(false), child: Text(s.sgKeep)),
          FilledButton(
            key: const Key('sgCancelYes'),
            onPressed: () => Navigator.of(c).pop(true),
            child: Text(s.cancel),
          ),
        ],
      ),
    );
    if (yes != true) return;
    try {
      await ref
          .read(apiProvider)
          .gatePassStaffCancel(id: '${pass['id']}', body: const PassCancelDto());
      ref.invalidate(staffGateMineProvider(profile));
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.sgCancelled)));
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final p = pass;
    final id = '${p['id']}';
    final state = '${p['state']}';
    final tint = switch (state) {
      'pending' => Tokens.mobAmber50,
      'approved' => Tokens.mobGreen50,
      'rejected' => Tokens.mobRed50,
      _ => Tokens.mobCyan100,
    };
    final extra = [
      if (p['destination'] != null) '${p['destination']}',
      if ((p['items'] as num? ?? 0) > 0) s.sgItems((p['items'] as num).toInt()),
      if (state == 'pending' && p['waitingOn'] != null) s.sgWaitingOn('${p['waitingOn']}'),
      if (p['outAt'] != null) s.sgGateOut(_istTime(p['outAt'])),
      if (p['inAt'] != null) s.sgGateIn(_istTime(p['inAt'])),
      if (p['decisionNote'] != null) '${p['decisionNote']}',
    ];
    return Card(
      key: Key('sgMine-$id'),
      margin: const EdgeInsets.only(bottom: Tokens.sp3),
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    '${p['number'] ?? ''} · ${s.sgKind('${p['kind']}')}',
                    style: const TextStyle(fontWeight: Tokens.fwSemibold),
                  ),
                ),
                const SizedBox(width: Tokens.sp2),
                Flexible(child: Tag('${p['stage'] ?? state}', color: tint)),
              ],
            ),
            const SizedBox(height: Tokens.sp1),
            Text(_when(s, p)),
            if (extra.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: Tokens.sp1),
                child: Text(extra.join(' · '), style: TextStyle(color: muted, fontSize: 13)),
              ),
            if (p['passNo'] != null || state == 'pending' || state == 'approved')
              Padding(
                padding: const EdgeInsets.only(top: Tokens.sp2),
                child: Wrap(
                  spacing: Tokens.sp2,
                  runSpacing: Tokens.sp2,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    if (p['passNo'] != null)
                      FileIcons(
                        name: 'sgCard-$id',
                        label: s.sgCard,
                        load: () => ref.read(apiProvider).gatePassStaffCardJson(id: id),
                      ),
                    if (state == 'pending' || state == 'approved')
                      OutlinedButton(
                        key: Key('sgCancel-$id'),
                        onPressed: () => _cancel(context, ref),
                        child: Text(s.cancel),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// One item carried out: what, how many, its number, whether it comes back.
class _Item {
  final name = TextEditingController();
  final qty = TextEditingController(text: '1');
  final serial = TextEditingController();
  bool back = true;
  void dispose() {
    name.dispose();
    qty.dispose();
    serial.dispose();
  }
}

/// My own gate pass (0069), as the websites' Apply for a gate pass: RGP (I come back today) or NRGP (I do not) as two
/// tiles, the date and times, the purpose and where, and what I carry out — none to start with, a row per item
/// added (up to 30), each removable.
class StaffGatePassForm extends ConsumerStatefulWidget {
  const StaffGatePassForm({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<StaffGatePassForm> createState() => _StaffGatePassFormState();
}

class _StaffGatePassFormState extends ConsumerState<StaffGatePassForm> {
  String _category = 'rgp';
  late DateTime _on = schoolToday();
  TimeOfDay? _out;
  TimeOfDay? _back;
  final _reason = TextEditingController();
  final _destination = TextEditingController();
  final List<_Item> _items = [];
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _reason.dispose();
    _destination.dispose();
    for (final i in _items) {
      i.dispose();
    }
    super.dispose();
  }

  String _hm(TimeOfDay t) =>
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  Future<void> _send() async {
    final s = ref.read(stringsProvider);
    final problem = _out == null
        ? s.sgNeedOut
        : _category == 'rgp' && _back == null
        ? s.sgNeedBack
        : _back != null && _hm(_back!).compareTo(_hm(_out!)) <= 0
        ? s.sgBackAfterOut
        : _reason.text.trim().length < 3
        ? s.sgNeedPurpose
        : _items.any((i) => i.name.text.trim().length < 2)
        ? s.sgNeedName
        : null;
    if (problem != null) {
      setState(() => _error = problem);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .gatePassStaffApply(
            body: StaffPassDto(
              category: _category,
              onDate: ymd(_on),
              atTime: _hm(_out!),
              returnTime: _category == 'rgp' && _back != null ? _hm(_back!) : null,
              reason: _reason.text.trim(),
              destination: _destination.text.trim().isEmpty ? null : _destination.text.trim(),
              items: [
                for (final i in _items)
                  StaffPassDtoItemsItem(
                    name: i.name.text.trim(),
                    qty: int.tryParse(i.qty.text.trim()) ?? 1,
                    serialNo: i.serial.text.trim().isEmpty ? null : i.serial.text.trim(),
                    returnable: i.back,
                  ),
              ],
            ),
          );
      ref.invalidate(staffGateMineProvider(widget.profile));
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.sgRequested)));
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final today = schoolToday();
    return ListView(
      key: const Key('sgForm'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        Text(s.sgApplyHelp, style: TextStyle(color: muted)),
        SectionTitle(s.sgType),
        // the type as two tiles, as on the websites
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          children: [
            for (final (key, value, label) in [
              (const Key('sgRgp'), 'rgp', s.sgRgp),
              (const Key('sgNrgp'), 'nrgp', s.sgNrgp),
            ])
              Semantics(
                selected: _category == value,
                inMutuallyExclusiveGroup: true,
                child: _category == value
                    ? FilledButton(key: key, onPressed: () {}, child: Text(label))
                    : OutlinedButton(
                        key: key,
                        onPressed: () => setState(() => _category = value),
                        child: Text(label),
                      ),
              ),
          ],
        ),
        const SizedBox(height: Tokens.sp4),
        _PickField(
          key: const Key('sgOn'),
          label: s.sgDate,
          value: s.date(_on),
          icon: Icons.event,
          onTap: () async {
            final d = await showDatePicker(
              context: context,
              initialDate: _on,
              firstDate: today,
              lastDate: today.add(const Duration(days: 365)),
            );
            if (d != null) setState(() => _on = d);
          },
        ),
        const SizedBox(height: Tokens.sp3),
        _PickField(
          key: const Key('sgOut'),
          label: s.sgOutAt,
          value: _out == null ? null : _hm(_out!),
          hint: s.sgChoose,
          icon: Icons.schedule,
          onTap: () async {
            final t = await showTimePicker(
              context: context,
              initialTime: _out ?? const TimeOfDay(hour: 11, minute: 0),
            );
            if (t != null) setState(() => _out = t);
          },
        ),
        if (_category == 'rgp') ...[
          const SizedBox(height: Tokens.sp3),
          _PickField(
            key: const Key('sgBack'),
            label: s.sgBackAt,
            value: _back == null ? null : _hm(_back!),
            hint: s.sgChoose,
            icon: Icons.schedule,
            onTap: () async {
              final t = await showTimePicker(
                context: context,
                initialTime: _back ?? const TimeOfDay(hour: 13, minute: 0),
              );
              if (t != null) setState(() => _back = t);
            },
          ),
        ],
        const SizedBox(height: Tokens.sp3),
        TextField(
          key: const Key('sgPurpose'),
          controller: _reason,
          maxLength: 300,
          decoration: InputDecoration(
            labelText: s.sgPurpose,
            border: const OutlineInputBorder(),
            counterText: '',
          ),
        ),
        const SizedBox(height: Tokens.sp3),
        TextField(
          key: const Key('sgGoingTo'),
          controller: _destination,
          maxLength: 160,
          decoration: InputDecoration(
            labelText: s.sgGoingTo,
            border: const OutlineInputBorder(),
            counterText: '',
          ),
        ),
        SectionTitle(s.sgItemsTitle),
        if (_items.isEmpty)
          Text(
            s.sgNoItems,
            key: const Key('sgNoItems'),
            style: TextStyle(color: muted, fontSize: 13),
          ),
        for (final (n, item) in _items.indexed)
          Card(
            key: ObjectKey(item),
            margin: const EdgeInsets.only(bottom: Tokens.sp2),
            child: Padding(
              padding: const EdgeInsets.all(Tokens.sp3),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextField(
                    key: Key('sgItemName-$n'),
                    controller: item.name,
                    maxLength: 120,
                    decoration: InputDecoration(labelText: s.sgItem(n + 1), counterText: ''),
                  ),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          key: Key('sgItemQty-$n'),
                          controller: item.qty,
                          keyboardType: TextInputType.number,
                          decoration: InputDecoration(labelText: s.sgQty),
                        ),
                      ),
                      const SizedBox(width: Tokens.sp2),
                      Expanded(
                        flex: 2,
                        child: TextField(
                          key: Key('sgItemSerial-$n'),
                          controller: item.serial,
                          maxLength: 60,
                          decoration: InputDecoration(labelText: s.sgSerial, counterText: ''),
                        ),
                      ),
                    ],
                  ),
                  CheckboxListTile(
                    key: Key('sgItemBack-$n'),
                    contentPadding: EdgeInsets.zero,
                    value: item.back,
                    onChanged: (v) => setState(() => item.back = v ?? true),
                    title: Text(s.sgBringBack),
                    controlAffinity: ListTileControlAffinity.leading,
                  ),
                  OutlinedButton(
                    key: Key('sgItemRemove-$n'),
                    onPressed: () => setState(() => _items.removeAt(n).dispose()),
                    child: Semantics(
                      label: s.sgRemoveItem(n + 1),
                      excludeSemantics: true,
                      child: Text(s.sgRemove),
                    ),
                  ),
                ],
              ),
            ),
          ),
        const SizedBox(height: Tokens.sp2),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton(
            key: const Key('sgAddItem'),
            onPressed: _items.length >= 30 ? null : () => setState(() => _items.add(_Item())),
            child: Text(s.sgAddItem),
          ),
        ),
        if (_error != null) ErrorText(_error!),
        const SizedBox(height: Tokens.sp3),
        Align(
          alignment: Alignment.centerLeft,
          child: FilledButton(
            key: const Key('sgSend'),
            onPressed: _busy ? null : _send,
            child: Text(s.sgSend),
          ),
        ),
      ],
    );
  }
}

/// A date or time chosen with a picker, shown as a labelled field (as the websites' inputs): the label, the value (or
/// a hint) and its icon; a tap opens the picker.
class _PickField extends StatelessWidget {
  const _PickField({
    super.key,
    required this.label,
    required this.value,
    required this.icon,
    required this.onTap,
    this.hint,
  });
  final String label;
  final String? value;
  final String? hint;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Semantics(
    button: true,
    label: '$label: ${value ?? hint ?? ''}',
    excludeSemantics: true,
    child: InkWell(
      onTap: onTap,
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          border: const OutlineInputBorder(),
          suffixIcon: Icon(icon),
        ),
        child: Text(value ?? hint ?? ''),
      ),
    ),
  );
}
