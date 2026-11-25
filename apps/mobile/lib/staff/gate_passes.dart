import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart' show ApiFile;

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/paged_feed.dart';
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

  // one pass in full, as the admin's gate pass page
  String get sgDetails => _sg('Details', 'विवरण');
  String get sgYourApproval => _sg('Your approval', 'आपकी स्वीकृति');
  String get sgPhotos => _sg('Photos to compare', 'मिलान हेतु फ़ोटो');
  String sgParty(String k) => switch (k) {
    'student' => _sg('Student', 'विद्यार्थी'),
    'father' => _sg('Father', 'पिता'),
    'mother' => _sg('Mother', 'माता'),
    'guardian' => _sg('Guardian', 'अभिभावक'),
    _ => _sg('Collecting (taken at the front desk)', 'लेने आए व्यक्ति (फ्रंट डेस्क पर ली गई)'),
  };
  String get sgNoPhotos => _sg(
    'No photo is on the school’s record for this pupil or the parents.',
    'इस विद्यार्थी या माता-पिता की कोई फ़ोटो विद्यालय के रिकॉर्ड में नहीं है।',
  );
  String sgOnRecord(String who) => _sg('On record: $who', 'रिकॉर्ड में: $who');
  String sgMobileEnding(String end) => _sg('mobile ending $end', 'मोबाइल अंत $end');
  String sgHandoverInfo(bool hostel, bool otp) => _sg(
    'Approved. The ${hostel ? 'hostel warden' : 'front desk'} hands the child over (photo${otp ? ' and the parent’s code' : ''}); the gate can let the child out only after that.',
    'स्वीकृत। ${hostel ? 'छात्रावास वार्डन' : 'फ्रंट डेस्क'} बच्चे को सौंपते हैं (फ़ोटो${otp ? ' और अभिभावक का कोड' : ''}); उसके बाद ही गेट बच्चे को बाहर जाने देता है।',
  );
  String get sgFPass => _sg('Pass', 'पास');
  String get sgFStudent => _sg('Student', 'विद्यार्थी');
  String get sgFEmployee => _sg('Employee', 'कर्मचारी');
  String get sgFDesignation => _sg('Designation', 'पदनाम');
  String get sgFDateTime => _sg('Date and time', 'तिथि और समय');
  String get sgFNotReturning => _sg('Not returning today', 'आज नहीं लौट रहे');
  String get sgFCollectedBy => _sg('Collected by', 'लेने वाले');
  String get sgFCollectorMobile => _sg('Collector’s mobile', 'लेने वाले का मोबाइल');
  String get sgFGoingTo => _sg('Going to', 'कहाँ जा रहे हैं');
  String get sgFReason => _sg('Reason', 'कारण');
  String get sgFAskedBy => _sg('Asked by', 'किसने माँगा');
  String sgFOn(String who, String when) => _sg('$who on $when', '$who, $when');
  String get sgFMadeAt => _sg('Made at', 'कहाँ बना');
  String sgFSource(String source, bool student) => source == 'front_desk'
      ? _sg('The front desk', 'फ्रंट डेस्क')
      : student
      ? _sg('The parent portal', 'अभिभावक पोर्टल')
      : _sg('The employee', 'कर्मचारी स्वयं');
  String get sgFHandedOver => _sg('Handed over', 'सौंपा गया');
  String sgFBy(String when, String who) => _sg('$when by $who', '$when, $who द्वारा');
  String get sgFRemark => _sg('Front desk remark', 'फ्रंट डेस्क टिप्पणी');
  String get sgFParentCode => _sg('Parent’s code', 'अभिभावक का कोड');
  String get sgFConfirmed => _sg('Confirmed', 'पुष्टि हुई');
  String get sgFGateOut => _sg('Gate out', 'गेट से बाहर');
  String get sgFGateIn => _sg('Gate in', 'गेट से अंदर');
  String get sgFOutside => _sg('Time outside', 'बाहर रहने का समय');
  String sgFOutsideFor(int min) => min >= 60
      ? _sg('${min ~/ 60} h ${min % 60} min', '${min ~/ 60} घं ${min % 60} मि')
      : _sg('$min min', '$min मि');
  String get sgFLateBack => _sg('back after the allowed time', 'अनुमत समय के बाद लौटे');
  String get sgFGateNote => _sg('Gate note', 'गेट टिप्पणी');
  String get sgFNote => _sg('Note', 'टिप्पणी');
  String get sgItemsOut => _sg('Items carried out', 'बाहर ले जाया गया सामान');
  String get sgToComeBack => _sg('To come back', 'वापस आना है');
  String get sgCameBack => _sg('Came back', 'वापस आया');
  String sgOf(int n, int of) => _sg('$n of $of', '$of में से $n');
  String get sgYes => _sg('Yes', 'हाँ');
  String get sgNo => _sg('No', 'नहीं');
  String get sgApprovalTitle => _sg('Approval', 'स्वीकृति');
  String sgAnyOf(int n, bool mandatory) => _sg(
    'Any $n of these approve${mandatory ? ', and every level marked “must approve”' : ''}.',
    'इनमें से कोई $n स्वीकृत करें${mandatory ? ', और “अवश्य स्वीकृत करें” वाला हर स्तर' : ''}।',
  );
  String get sgInOrder => _sg('One after another, in this order.', 'एक के बाद एक, इसी क्रम में।');
  String get sgMustApprove => _sg('Must approve', 'अवश्य स्वीकृत करें');
  String sgLevelStatus(String st) => switch (st) {
    'waiting' => _sg('Waits its turn', 'अपनी बारी की प्रतीक्षा'),
    'pending' => _sg('To decide now', 'अभी निर्णय'),
    'approved' => _sg('Approved', 'स्वीकृत'),
    'rejected' => _sg('Rejected', 'अस्वीकृत'),
    _ => _sg('Skipped', 'छोड़ा गया'),
  };
  String sgWho(String who) => _sg('Who: $who', 'कौन: $who');
  String sgDecidedBy(String who) => _sg('Decided by $who', '$who द्वारा निर्णय');
  String get sgPassCard => _sg('Pass card', 'पास कार्ड');
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

/// Gate passes as on the staff website (0069): **To approve** — the passes that wait on me (as class teacher,
/// coordinator, vice principal or principal), approve or reject with a note — and **My gate passes** — my own passes
/// to go out during school (RGP / NRGP): follow, cancel, the pass card, and apply. No web page.
class StaffGatePassesScreen extends ConsumerStatefulWidget {
  const StaffGatePassesScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<StaffGatePassesScreen> createState() => _StaffGatePassesScreenState();
}

class _StaffGatePassesScreenState extends ConsumerState<StaffGatePassesScreen> {
  /// how many wait on me in all (each page of To approve says)
  int _waiting = 0;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final profile = widget.profile;
    final waiting = _waiting;
    return DefaultTabController(
      length: 2,
      // Apply for a gate pass on both tabs (as the website's header button); a sent one shows under My gate passes.
      // Its own messenger: the "requested" note shows above the button, not over it.
      child: ScaffoldMessenger(
        child: Builder(
          builder: (context) => Scaffold(
            backgroundColor: Colors.transparent,
            floatingActionButton: FloatingActionButton.extended(
              key: const Key('sgApply'),
              icon: const Icon(Icons.add),
              label: Text(s.sgApply),
              onPressed: () async {
                final tabs = DefaultTabController.of(context);
                final sent = await Navigator.of(context).push<bool>(
                  MaterialPageRoute(
                    builder: (_) => FamilyPage(
                      title: s.sgApply,
                      child: StaffGatePassForm(profile: profile),
                    ),
                  ),
                );
                if (sent == true && context.mounted) {
                  tabs.animateTo(1);
                  ScaffoldMessenger.of(context)
                      .showSnackBar(SnackBar(content: Text(s.sgRequested)));
                }
              },
            ),
            body: Column(
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
                      _InboxTab(
                        profile: profile,
                        onWaiting: (n) {
                          if (mounted && n != _waiting) setState(() => _waiting = n);
                        },
                      ),
                      _MineTab(profile: profile),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
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

/// The passes waiting on me, the soonest 10 first and 10 more as I scroll (as the staff website).
class _InboxTab extends ConsumerWidget {
  const _InboxTab({required this.profile, required this.onWaiting});
  final Profile profile;
  final void Function(int waiting) onWaiting;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final round = ref.watch(feedRoundProvider('gate-inbox'));
    return PagedFeed(
      key: ValueKey('sgInboxFeed-$round'),
      firstCacheKey: 'gate-inbox-feed:${profile.id}',
      load: (page) => ref.read(apiProvider).gatePassInbox(page: page, size: 10),
      parse: (a, page) {
        final total = (asJson(a['page'])['total'] as num?)?.toInt() ?? 0;
        return (items: asList(a['data']), more: page * 10 < total, total: total);
      },
      onAnswer: (a) => onWaiting((a['waiting'] as num?)?.toInt() ?? 0),
      empty: s.sgNothingWaits,
      emptyCard: Notice(text: s.sgNothingWaits),
      // room for the floating Apply button
      endGap: 88,
      item: (context, p, _) =>
          _InboxCard(key: ValueKey('sgInboxCard-${p['id']}'), profile: profile, pass: p),
    );
  }
}

class _InboxCard extends ConsumerStatefulWidget {
  const _InboxCard({super.key, required this.profile, required this.pass});
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
      ref.read(feedRoundProvider('gate-inbox').notifier).bump();
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
            Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton.icon(
                key: Key('sgOpen-$id'),
                icon: const Icon(Icons.article_outlined),
                label: Text(s.sgDetails),
                onPressed: () => openStaffGatePass(context, widget.profile, id),
              ),
            ),
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

/// My own passes, the latest 10 first and 10 more as I scroll (as the staff website).
class _MineTab extends ConsumerWidget {
  const _MineTab({required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final round = ref.watch(feedRoundProvider('gate-mine'));
    return PagedFeed(
      key: ValueKey('sgMineFeed-$round'),
      firstCacheKey: 'gate-mine-feed:${profile.id}',
      load: (page) => ref.read(apiProvider).gatePassStaff(page: page, size: 10),
      parse: (a, page) {
        final total = (asJson(a['page'])['total'] as num?)?.toInt() ?? 0;
        return (items: asList(a['data']), more: page * 10 < total, total: total);
      },
      empty: s.sgNoneMine,
      emptyCard: Notice(text: s.sgNoneMine),
      // room for the floating Apply button
      endGap: 88,
      item: (context, p, _) => _MineCard(profile: profile, pass: p),
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
      ref.read(feedRoundProvider('gate-mine').notifier).bump();
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
            Padding(
              padding: const EdgeInsets.only(top: Tokens.sp2),
              child: Wrap(
                spacing: Tokens.sp2,
                runSpacing: Tokens.sp2,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  OutlinedButton.icon(
                    key: Key('sgOpen-$id'),
                    icon: const Icon(Icons.article_outlined),
                    label: Text(s.sgDetails),
                    onPressed: () => openStaffGatePass(context, profile, id),
                  ),
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

/// One pass in full (as the admin's gate pass page).
final staffGatePassProvider = FutureProvider.autoDispose.family<Json, String>(
  (ref, id) async => asJson(await ref.read(apiProvider).gatePassGet(id: id)),
);

/// Opens one pass in full.
void openStaffGatePass(BuildContext context, Profile profile, String id) => pushPage(
  context,
  ProviderScope.containerOf(context, listen: false).read(stringsProvider).sgDetails,
  StaffGatePassDetail(profile: profile, id: id),
);

/// One gate pass with everything on it, as the admin's page: who and why, its stage and the pass card; my approval
/// when it waits on me; the photos to compare (a pupil's pass); the details; the items carried and how many came
/// back; the approval levels. The front desk and the gate hand over and let out on their own screens.
class StaffGatePassDetail extends ConsumerStatefulWidget {
  const StaffGatePassDetail({super.key, required this.profile, required this.id});
  final Profile profile;
  final String id;

  @override
  ConsumerState<StaffGatePassDetail> createState() => _StaffGatePassDetailState();
}

class _StaffGatePassDetailState extends ConsumerState<StaffGatePassDetail> {
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
    if (outcome == 'rejected' && note.isEmpty) return setState(() => _error = s.sgNeedNote);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .gatePassDecide(
            id: widget.id,
            body: PassDecideDto(outcome: outcome, note: note.isEmpty ? null : note),
          );
      ref.read(feedRoundProvider('gate-inbox').notifier).bump();
      ref.invalidate(staffGatePassProvider(widget.id));
      // the header's Approvals count reads again
      ref.invalidate(approvalsProvider);
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(outcome == 'approved' ? s.sgApproved : s.sgRejected)));
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _at(S s, Object? v) {
    final d = DateTime.tryParse('$v');
    return d == null ? '' : s.dateTime(d);
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final api = ref.read(apiProvider);
    return AsyncBody<Json>(
      value: ref.watch(staffGatePassProvider(widget.id)),
      retry: () => ref.invalidate(staffGatePassProvider(widget.id)),
      data: (p) {
        final student = p['audience'] == 'student';
        final state = '${p['state']}';
        final kind = '${p['kind']}';
        final escort = p['escortName'] != null
            ? '${p['escortName']}${p['escortRelation'] != null ? ' (${p['escortRelation']})' : ''}'
            : null;
        final out = DateTime.tryParse('${p['outAt']}');
        final back = DateTime.tryParse('${p['inAt']}');
        final minutes = out != null && back != null
            ? back.difference(out).inMinutes.clamp(0, 100000)
            : null;
        final returnBy = DateTime.tryParse('${p['returnBy']}');
        final late =
            kind == 'rgp' &&
            returnBy != null &&
            out != null &&
            (back ?? DateTime.now()).isAfter(returnBy);
        final facts = <(String, String?)>[
          (s.sgFPass, '${p['kindLabel'] ?? s.sgKind(kind)} · ${p['number']}'),
          (student ? s.sgFStudent : s.sgFEmployee, p['who'] as String?),
          (s.sgFDesignation, student ? null : p['designation'] as String?),
          (
            s.sgFDateTime,
            '${s.date(p['onDate'] ?? '')}${p['atTime'] != null ? ', ${s.time('${p['atTime']}')}' : ''}',
          ),
          (
            s.sgBackAt,
            returnBy != null ? _at(s, p['returnBy']) : (kind == 'nrgp' ? s.sgFNotReturning : null),
          ),
          (s.sgFCollectedBy, escort),
          (s.sgFCollectorMobile, p['escortMobile'] as String?),
          (s.sgFGoingTo, p['destination'] as String?),
          (s.sgFReason, p['reason'] as String?),
          (
            s.sgFAskedBy,
            p['requestedBy'] != null
                ? s.sgFOn('${p['requestedBy']}', _at(s, p['createdAt']))
                : _at(s, p['createdAt']),
          ),
          (s.sgFMadeAt, s.sgFSource('${p['source']}', student)),
          (
            s.sgFHandedOver,
            p['handoverAt'] != null
                ? (p['handoverBy'] != null
                      ? s.sgFBy(_at(s, p['handoverAt']), '${p['handoverBy']}')
                      : _at(s, p['handoverAt']))
                : null,
          ),
          (s.sgFRemark, p['handoverRemark'] as String?),
          (s.sgFParentCode, p['otpVerified'] == true ? s.sgFConfirmed : null),
          (
            s.sgFGateOut,
            p['outAt'] != null
                ? '${_at(s, p['outAt'])}${p['outGate'] != null ? ' · ${p['outGate']}' : ''}'
                : null,
          ),
          (s.sgFGateIn, p['inAt'] != null ? _at(s, p['inAt']) : null),
          (
            s.sgFOutside,
            minutes != null
                ? '${s.sgFOutsideFor(minutes)}${late ? ' · ${s.sgFLateBack}' : ''}'
                : null,
          ),
          (s.sgFGateNote, p['gateNote'] as String?),
          (s.sgFNote, (p['decisionNote'] ?? p['cancelReason']) as String?),
        ].where((f) => f.$2 != null && f.$2!.isNotEmpty).toList();
        final photos = asJson(p['photos']);
        final parties = [
          for (final k in const ['student', 'father', 'mother', 'guardian', 'collector'])
            if (photos[k] == true) k,
        ];
        final items = asList(p['itemList']);
        final approvals = asList(p['approvals']);
        final tint = switch (state) {
          'pending' => Tokens.mobAmber50,
          'approved' => Tokens.mobGreen50,
          'rejected' => Tokens.mobRed50,
          _ => Tokens.mobCyan100,
        };
        Widget card(String title, List<Widget> children, {Key? key}) => Card(
          key: key,
          margin: const EdgeInsets.only(top: Tokens.sp3),
          child: Padding(
            padding: const EdgeInsets.all(Tokens.sp4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Semantics(
                  header: true,
                  child: Text(
                    title,
                    style: Theme.of(context).textTheme.titleMedium
                        ?.copyWith(fontWeight: Tokens.fwBold),
                  ),
                ),
                const SizedBox(height: Tokens.sp2),
                ...children,
              ],
            ),
          ),
        );
        return ListView(
          key: const Key('sgDetail'),
          padding: const EdgeInsets.all(Tokens.sp4),
          children: [
            Text(
              s.hindi ? 'गेट पास ${p['number']}' : 'Gate pass ${p['number']}',
              style: TextStyle(color: muted, fontSize: 14),
            ),
            Text(
              '${p['student'] ?? p['employee'] ?? ''}',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: Tokens.fwBold),
            ),
            Text('${p['kindLabel'] ?? s.sgKind(kind)}', style: TextStyle(color: muted)),
            const SizedBox(height: Tokens.sp2),
            Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp2,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Tag('${p['stage'] ?? state}', color: tint),
                if (p['passNo'] != null)
                  FileIcons(
                    name: 'sgDetailCard',
                    label: s.sgPassCard,
                    load: () => api.gatePassCard(id: widget.id),
                  ),
              ],
            ),
            if (p['canDecide'] == true)
              card(s.sgYourApproval, key: const Key('sgDetailDecide'), [
                TextField(
                  key: const Key('sgDetailNote'),
                  controller: _note,
                  maxLength: 300,
                  decoration: InputDecoration(
                    labelText: s.sgNote,
                    border: const OutlineInputBorder(),
                    counterText: '',
                  ),
                ),
                if (_error != null) ErrorText(_error!),
                const SizedBox(height: Tokens.sp2),
                Wrap(
                  spacing: Tokens.sp2,
                  runSpacing: Tokens.sp2,
                  children: [
                    FilledButton(
                      key: const Key('sgDetailApprove'),
                      onPressed: _busy ? null : () => _decide('approved'),
                      child: Text(s.sgApprove),
                    ),
                    OutlinedButton(
                      key: const Key('sgDetailReject'),
                      onPressed: _busy ? null : () => _decide('rejected'),
                      child: Text(s.sgReject),
                    ),
                  ],
                ),
              ]),
            if (student)
              card(s.sgPhotos, key: const Key('sgDetailPhotos'), [
                if (parties.isEmpty)
                  Text(s.sgNoPhotos, style: TextStyle(color: muted))
                else
                  Wrap(
                    spacing: Tokens.sp3,
                    runSpacing: Tokens.sp3,
                    children: [
                      for (final k in parties)
                        _PassPhoto(
                          key: Key('sgPhoto-$k'),
                          label: s.sgParty(k),
                          load: () => k == 'collector'
                              ? api.gatePassCollector(id: widget.id)
                              : api.gatePassRecordPhoto(id: widget.id, party: k),
                        ),
                    ],
                  ),
                if (asList(p['guardians']).isNotEmpty) ...[
                  const SizedBox(height: Tokens.sp2),
                  Text(
                    s.sgOnRecord(
                      asList(p['guardians'])
                          .map(
                            (g) =>
                                '${g['name']} (${g['relation']}${g['mobileEnd'] != null ? ', ${s.sgMobileEnding('${g['mobileEnd']}')}' : ''})',
                          )
                          .join(' · '),
                    ),
                    style: TextStyle(color: muted, fontSize: 13),
                  ),
                ],
              ]),
            if (state == 'approved' && student && (kind == 'early_leave' || kind == 'hostel_home'))
              Padding(
                padding: const EdgeInsets.only(top: Tokens.sp3),
                child: Notice(
                  key: const Key('sgDetailHandover'),
                  text: s.sgHandoverInfo(kind == 'hostel_home', p['otpNeeded'] == true),
                ),
              ),
            card(s.sgDetails, key: const Key('sgDetailFacts'), [
              for (final (k, v) in facts)
                Padding(
                  padding: const EdgeInsets.only(bottom: Tokens.sp2),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(k, style: TextStyle(color: muted, fontSize: 13)),
                      SelectionArea(child: Text(v!)),
                    ],
                  ),
                ),
            ]),
            if (items.isNotEmpty)
              card(s.sgItemsOut, key: const Key('sgDetailItems'), [
                for (final i in items)
                  Padding(
                    padding: const EdgeInsets.only(bottom: Tokens.sp2),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${i['name']}${i['serialNo'] != null ? ' · ${i['serialNo']}' : ''}',
                          style: const TextStyle(fontWeight: Tokens.fwSemibold),
                        ),
                        Text(
                          [
                            '${s.sgQty}: ${i['qty']}',
                            '${s.sgToComeBack}: ${i['returnable'] == true ? s.sgYes : s.sgNo}',
                            if (i['returnable'] == true)
                              '${s.sgCameBack}: ${s.sgOf((i['returnedQty'] as num? ?? 0).toInt(), (i['qty'] as num? ?? 0).toInt())}${i['returnedAt'] != null ? ' · ${_at(s, i['returnedAt'])}' : ''}',
                          ].join(' · '),
                          style: TextStyle(color: muted, fontSize: 13),
                        ),
                      ],
                    ),
                  ),
              ]),
            card(s.sgApprovalTitle, key: const Key('sgDetailApprovals'), [
              Text(
                p['approvalMode'] == 'any'
                    ? s.sgAnyOf(
                        (p['approvalNeed'] as num? ?? 1).toInt(),
                        approvals.any((a) => a['mandatory'] == true),
                      )
                    : s.sgInOrder,
                style: TextStyle(color: muted, fontSize: 13),
              ),
              const SizedBox(height: Tokens.sp2),
              for (final a in approvals)
                Padding(
                  padding: const EdgeInsets.only(bottom: Tokens.sp3),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Wrap(
                        spacing: Tokens.sp2,
                        runSpacing: Tokens.sp1,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(
                            '${a['seq']}. ${a['label']}',
                            style: const TextStyle(fontWeight: Tokens.fwSemibold),
                          ),
                          Tag(
                            s.sgLevelStatus('${a['status']}'),
                            color: switch ('${a['status']}') {
                              'approved' => Tokens.mobGreen50,
                              'rejected' => Tokens.mobRed50,
                              'pending' => Tokens.mobAmber50,
                              _ => Tokens.mobGray100,
                            },
                          ),
                          if (a['mandatory'] == true)
                            Tag(s.sgMustApprove, color: Tokens.mobCyan100),
                        ],
                      ),
                      Text(
                        [
                          s.sgWho('${a['approvers'] ?? '—'}'),
                          if (a['actedBy'] != null)
                            '${s.sgDecidedBy('${a['actedBy']}')}${a['actedAt'] != null ? ', ${_at(s, a['actedAt'])}' : ''}',
                          if (a['note'] != null) '“${a['note']}”',
                        ].join(' · '),
                        style: TextStyle(color: muted, fontSize: 13),
                      ),
                    ],
                  ),
                ),
            ]),
          ],
        );
      },
    );
  }
}

/// One photo to compare (the pupil's record or the person collecting), with its label; nothing while it loads or
/// when it cannot be read.
class _PassPhoto extends StatefulWidget {
  const _PassPhoto({super.key, required this.label, required this.load});
  final String label;
  final Future<ApiFile> Function() load;

  @override
  State<_PassPhoto> createState() => _PassPhotoState();
}

class _PassPhotoState extends State<_PassPhoto> {
  late final Future<ApiFile> _file = widget.load();

  @override
  Widget build(BuildContext context) => SizedBox(
    width: 120,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(Tokens.radiusSm),
          child: SizedBox(
            width: 120,
            height: 140,
            child: FutureBuilder<ApiFile>(
              future: _file,
              builder: (context, snap) => snap.data == null
                  ? const ColoredBox(
                      color: Tokens.mobGray100,
                      child: Center(child: Icon(Icons.person_outline)),
                    )
                  : Image.memory(
                      Uint8List.fromList(snap.data!.bytes),
                      fit: BoxFit.cover,
                      semanticLabel: widget.label,
                      errorBuilder: (_, _, _) => const Icon(Icons.person_outline),
                    ),
            ),
          ),
        ),
        const SizedBox(height: Tokens.sp1),
        Text(widget.label, style: const TextStyle(fontSize: 13)),
      ],
    ),
  );
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
      ref.read(feedRoundProvider('gate-mine').notifier).bump();
      if (!mounted) return;
      // the Gate passes screen says it was requested
      Navigator.of(context).pop(true);
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
        // the type as two tiles, as on the websites: the chosen one navy, the other outlined; the words wrap
        for (final (key, value, label) in [
          (const Key('sgRgp'), 'rgp', s.sgRgp),
          (const Key('sgNrgp'), 'nrgp', s.sgNrgp),
        ]) ...[
          _TypeTile(
            key: key,
            label: label,
            selected: _category == value,
            onTap: () => setState(() => _category = value),
          ),
          const SizedBox(height: Tokens.sp2),
        ],
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
                    decoration: InputDecoration(
                      labelText: s.sgItem(n + 1),
                      border: const OutlineInputBorder(),
                      counterText: '',
                    ),
                  ),
                  const SizedBox(height: Tokens.sp3),
                  Builder(
                    builder: (context) {
                      final qty = TextField(
                        key: Key('sgItemQty-$n'),
                        controller: item.qty,
                        keyboardType: TextInputType.number,
                        decoration: InputDecoration(
                          labelText: s.sgQty,
                          border: const OutlineInputBorder(),
                        ),
                      );
                      final serial = TextField(
                        key: Key('sgItemSerial-$n'),
                        controller: item.serial,
                        maxLength: 60,
                        decoration: InputDecoration(
                          labelText: s.sgSerial,
                          border: const OutlineInputBorder(),
                          counterText: '',
                        ),
                      );
                      // with large text the two fields go one under the other, their labels whole
                      return MediaQuery.textScalerOf(context).scale(10) > 13
                          ? Column(
                              children: [
                                qty,
                                const SizedBox(height: Tokens.sp3),
                                serial,
                              ],
                            )
                          : Row(
                              children: [
                                Expanded(child: qty),
                                const SizedBox(width: Tokens.sp2),
                                Expanded(flex: 2, child: serial),
                              ],
                            );
                    },
                  ),
                  CheckboxListTile(
                    key: Key('sgItemBack-$n'),
                    contentPadding: EdgeInsets.zero,
                    value: item.back,
                    onChanged: (v) => setState(() => item.back = v ?? true),
                    title: Text(s.sgBringBack),
                    controlAffinity: ListTileControlAffinity.leading,
                  ),
                  Align(
                    alignment: AlignmentDirectional.centerEnd,
                    child: TextButton.icon(
                      key: Key('sgItemRemove-$n'),
                      icon: const Icon(Icons.delete_outline),
                      onPressed: () => setState(() => _items.removeAt(n).dispose()),
                      label: Semantics(
                        label: s.sgRemoveItem(n + 1),
                        excludeSemantics: true,
                        child: Text(s.sgRemove),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        const SizedBox(height: Tokens.sp2),
        Align(
          alignment: Alignment.centerLeft,
          child: OutlinedButton.icon(
            key: const Key('sgAddItem'),
            icon: const Icon(Icons.add),
            onPressed: _items.length >= 30 ? null : () => setState(() => _items.add(_Item())),
            label: Text(s.sgAddItem),
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

/// One type of pass as the websites' tile: the chosen one navy with white words and a tick, the other outlined; the
/// words wrap with large text.
class _TypeTile extends StatelessWidget {
  const _TypeTile({super.key, required this.label, required this.selected, required this.onTap});
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final ink = (dark ? Tokens.mobGray100 : Tokens.mobNavy800);
    return Semantics(
      button: true,
      selected: selected,
      inMutuallyExclusiveGroup: true,
      child: Material(
        color: selected ? Tokens.mobNavy800 : Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Tokens.radiusMd),
          side: BorderSide(color: selected ? Tokens.mobNavy800 : ink, width: 1.5),
        ),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(Tokens.radiusMd),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 48),
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: Tokens.sp4, vertical: Tokens.sp3),
              child: Row(
                children: [
                  Icon(
                    selected ? Icons.check_circle : Icons.radio_button_unchecked,
                    color: selected ? Tokens.textInverse : ink,
                  ),
                  const SizedBox(width: Tokens.sp3),
                  Expanded(
                    child: Text(
                      label,
                      style: TextStyle(
                        color: selected ? Tokens.textInverse : ink,
                        fontWeight: Tokens.fwSemibold,
                        fontSize: 16,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
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
