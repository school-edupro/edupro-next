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
import 'office_parts.dart';

/// The words of Issued to my department (as the staff website's, in English and Hindi).
extension IssueWords on S {
  String _is(String en, String hi) => hindi ? hi : en;

  String get isTitle => _is('Issued to my department', 'मेरे विभाग को निर्गत');
  String get isIntro => _is(
    'What the store issued to you or your department: confirm you received it. Each issue has its slip.',
    'भंडार ने आपको या आपके विभाग को जो निर्गत किया: प्राप्ति की पुष्टि करें। हर निर्गम की अपनी पर्ची है।',
  );
  String get isToAck => _is('To acknowledge', 'पुष्टि करनी है');
  String get isAcked => _is('Acknowledged', 'पुष्टि हुई');
  String get isNothing => _is(
    'Nothing is waiting for your acknowledgement.',
    'आपकी पुष्टि के लिए कुछ प्रतीक्षा में नहीं है।',
  );
  String get isEarlier => _is('Received earlier', 'पहले प्राप्त');
  String isFrom(String store, String day) => _is('From $store on $day', '$store से, $day को');
  String isFor(String indent) => _is('for $indent', '$indent हेतु');
  String isTakenBy(String who) => _is('taken by $who', '$who ने लिया');
  String isLines(int n) => n == 1 ? _is('1 line', '1 पंक्ति') : _is('$n lines', '$n पंक्तियाँ');
  String get isOpen => _is('Open and acknowledge', 'खोलें और पुष्टि करें');
  String get isDetails => _is('Details', 'विवरण');
  String isSlip(String n) => _is('Issue slip $n', 'निर्गम पर्ची $n');
  String get isSlipWord => _is('Slip', 'पर्ची');
  String get isStatus => _is('Status', 'स्थिति');
  String isAckedBy(String who, String day) => _is('by $who on $day', '$who द्वारा, $day को');
  String isForIndent(String indent) => _is('For $indent', '$indent हेतु');
  String get isNote => _is('Note (anything short or damaged)', 'टिप्पणी (कुछ कम या क्षतिग्रस्त)');
  String get isAck => _is('Acknowledge: received', 'पुष्टि करें: प्राप्त हुआ');
  String get isAckDone => _is('Acknowledged: received', 'पुष्टि हुई: प्राप्त हुआ');
  String get isWhatCame => _is('What came', 'क्या आया');
  String get isQuantity => _is('Quantity', 'मात्रा');
  String isBatch(String b) => _is('Batch $b', 'बैच $b');
  String isBack(String q) => _is('$q brought back', '$q वापस लाए');
}

String _qty(Object? v) {
  final n = num.tryParse('$v') ?? 0;
  final r = (n * 1000).round() / 1000;
  return r == r.roundToDouble() ? '${r.toInt()}' : '$r';
}

/// What waits for my acknowledgement, and what came earlier (acknowledged).
final myIssuesProvider = FutureProvider.autoDispose
    .family<Loaded<(List<Json>, List<Json>)>, Profile>((ref, p) async {
      final api = ref.read(apiProvider);
      final waiting = await cached(
        'issues-mine:${p.id}',
        () => api.purchaseStockListIssues(mine: '1'),
      );
      final earlier = await cached(
        'issues-earlier:${p.id}',
        () => api.purchaseStockListIssues(received: '1', status: 'acknowledged'),
      );
      return Loaded(
        (asList(asJson(waiting.data)['rows']), asList(asJson(earlier.data)['rows'])),
        waiting.at,
        stale: waiting.stale || earlier.stale,
      );
    });

/// One issue in full.
final issueProvider = FutureProvider.autoDispose.family<Json, String>(
  (ref, id) async => asJson(await ref.read(apiProvider).purchaseStockGetIssue(id: id)),
);

/// Issued to my department as on the staff website (docs/design/84, part 8): what the store issued to me or my
/// department and waits for my acknowledgement — each opens to acknowledge — then what was received earlier; every
/// issue with its slip (View / Download). No web page.
class StaffIssuesScreen extends ConsumerWidget {
  const StaffIssuesScreen({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final api = ref.read(apiProvider);
    return LoadedList<(List<Json>, List<Json>)>(
      value: ref.watch(myIssuesProvider(profile)),
      refresh: () => ref.refresh(myIssuesProvider(profile).future),
      children: (d) {
        final (waiting, earlier) = d;
        final muted = officeMuted(context);
        String line(Json x) => [
          s.isFrom('${x['store'] ?? ''}', s.date(x['issuedOn'] ?? '')),
          if (x['indent'] != null) s.isFor('${x['indent']}'),
          if (x['takenBy'] != null) s.isTakenBy('${x['takenBy']}'),
          s.isLines((x['lines'] as num?)?.toInt() ?? 0),
        ].join(' · ');
        return [
          Text(s.isIntro, style: TextStyle(color: muted, fontSize: 14)),
          const SizedBox(height: Tokens.sp3),
          if (waiting.isEmpty) Notice(text: s.isNothing),
          for (final x in waiting)
            Card(
              key: Key('isWait-${x['id']}'),
              margin: const EdgeInsets.only(bottom: Tokens.sp3),
              child: Padding(
                padding: const EdgeInsets.all(Tokens.sp3),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${x['number']} · ${x['department'] ?? ''}',
                      style: const TextStyle(fontWeight: Tokens.fwBold),
                    ),
                    const SizedBox(height: Tokens.sp1),
                    StatusChip(s.isToAck, Tone.warning),
                    const SizedBox(height: Tokens.sp1),
                    Text(line(x)),
                    const SizedBox(height: Tokens.sp2),
                    Wrap(
                      spacing: Tokens.sp2,
                      runSpacing: Tokens.sp1,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        FilledButton(
                          key: Key('isOpen-${x['id']}'),
                          onPressed: () => openIssue(context, profile, x),
                          child: Text(s.isOpen),
                        ),
                        FileIcons(
                          label: s.isSlip('${x['number']}'),
                          name: 'isSlip-${x['id']}',
                          load: () => api.purchaseStockIssuePdf(id: '${x['id']}'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          if (earlier.isNotEmpty)
            officeCard(context, s.isEarlier, key: const Key('isEarlier'), [
              for (final x in earlier)
                Padding(
                  padding: const EdgeInsets.only(bottom: Tokens.sp2),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Wrap(
                        spacing: Tokens.sp2,
                        runSpacing: Tokens.sp1,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          TextButton(
                            key: Key('isOld-${x['id']}'),
                            onPressed: () => openIssue(context, profile, x),
                            child: Text('${x['number']}'),
                          ),
                          StatusChip(s.isAcked, Tone.success),
                          FileIcons(
                            label: s.isSlip('${x['number']}'),
                            name: 'isSlip-${x['id']}',
                            load: () => api.purchaseStockIssuePdf(id: '${x['id']}'),
                          ),
                        ],
                      ),
                      Text(line(x), style: TextStyle(color: muted, fontSize: 13)),
                    ],
                  ),
                ),
            ]),
        ];
      },
    );
  }
}

/// Opens one issue in full.
void openIssue(BuildContext context, Profile profile, Json row) =>
    pushPage(context, '${row['number']}', IssueDetailScreen(profile: profile, id: '${row['id']}'));

/// One issue as on the staff website: what kind and for which department, from which store and when, its status
/// (who acknowledged and the note), the indent it served and why, the slip, Acknowledge with a note while it waits,
/// and what came (item, batch, how much was brought back, the quantity).
class IssueDetailScreen extends ConsumerStatefulWidget {
  const IssueDetailScreen({super.key, required this.profile, required this.id});
  final Profile profile;
  final String id;

  @override
  ConsumerState<IssueDetailScreen> createState() => _IssueDetailScreenState();
}

class _IssueDetailScreenState extends ConsumerState<IssueDetailScreen> {
  final _note = TextEditingController();
  final _messenger = GlobalKey<ScaffoldMessengerState>();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  Future<void> _ack() async {
    final s = ref.read(stringsProvider);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final note = _note.text.trim();
      await ref
          .read(apiProvider)
          .purchaseStockAcknowledge(
            id: widget.id,
            body: IssueAcknowledgeDto(note: note.isEmpty ? null : note),
          );
      ref.invalidate(issueProvider(widget.id));
      ref.invalidate(myIssuesProvider(widget.profile));
      _messenger.currentState
        ?..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(s.isAckDone)));
    } catch (e) {
      if (mounted) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final api = ref.read(apiProvider);
    return ScaffoldMessenger(
      key: _messenger,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: AsyncBody<Json>(
          value: ref.watch(issueProvider(widget.id)),
          retry: () => ref.invalidate(issueProvider(widget.id)),
          data: (x) {
            final muted = officeMuted(context);
            final acked = x['status'] == 'acknowledged';
            final can = asJson(x['can']);
            final lines = asList(x['lineItems']);
            final acknowledgedAt = DateTime.tryParse('${x['acknowledgedAt']}');
            return ListView(
              key: const Key('isDetail'),
              padding: const EdgeInsets.all(Tokens.sp4),
              children: [
                Text(
                  '${x['kindLabel'] ?? ''} · ${x['department'] ?? ''}',
                  style: TextStyle(color: muted, fontSize: 14),
                ),
                Text(
                  '${x['number']}',
                  style: Theme.of(context).textTheme.titleLarge
                      ?.copyWith(fontWeight: Tokens.fwBold),
                ),
                Text(
                  [
                    s.isFrom('${x['store'] ?? ''}', s.date(x['issuedOn'] ?? '')),
                    if (x['takenBy'] != null) s.isTakenBy('${x['takenBy']}'),
                  ].join(' · '),
                ),
                officeCard(context, s.isStatus, [
                  Wrap(
                    spacing: Tokens.sp2,
                    runSpacing: Tokens.sp1,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      StatusChip(
                        acked ? s.isAcked : s.isToAck,
                        acked ? Tone.success : Tone.warning,
                      ),
                      if (acked)
                        Text(
                          '${s.isAckedBy('${x['acknowledgedBy'] ?? ''}', acknowledgedAt == null ? '' : s.date(acknowledgedAt.toLocal()))}${x['ackNote'] != null ? ': ${x['ackNote']}' : ''}',
                        ),
                    ],
                  ),
                  if (x['indent'] != null || x['purpose'] != null) ...[
                    const SizedBox(height: Tokens.sp2),
                    Text(
                      [
                        if (x['indent'] != null) s.isForIndent('${x['indent']}'),
                        if (x['purpose'] != null) '${x['purpose']}',
                      ].join(' · '),
                      style: TextStyle(color: muted, fontSize: 13),
                    ),
                  ],
                  Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(s.isSlipWord),
                      FileIcons(
                        label: s.isSlip('${x['number']}'),
                        name: 'isSlip-${x['id']}',
                        load: () => api.purchaseStockIssuePdf(id: widget.id),
                      ),
                    ],
                  ),
                  if (can['acknowledge'] == true) ...[
                    const SizedBox(height: Tokens.sp2),
                    TextField(
                      key: const Key('isNote'),
                      controller: _note,
                      maxLength: 300,
                      decoration: InputDecoration(
                        labelText: s.isNote,
                        border: const OutlineInputBorder(),
                      ),
                    ),
                    if (_error != null) ErrorText(_error!),
                    FilledButton(
                      key: const Key('isAck'),
                      onPressed: _busy ? null : _ack,
                      child: Text(s.isAck),
                    ),
                  ],
                ]),
                officeCard(context, s.isWhatCame, [
                  for (final l in lines)
                    Padding(
                      padding: const EdgeInsets.only(bottom: Tokens.sp2),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          FactLine(
                            '${l['item']} (${l['itemCode']})',
                            '${_qty(l['qty'])} ${l['unit'] ?? ''}',
                          ),
                          if (l['batch'] != null || ((l['returned'] as num?) ?? 0) > 0)
                            Text(
                              [
                                if (l['batch'] != null) s.isBatch('${l['batch']}'),
                                if (((l['returned'] as num?) ?? 0) > 0)
                                  s.isBack(_qty(l['returned'])),
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
        ),
      ),
    );
  }
}
