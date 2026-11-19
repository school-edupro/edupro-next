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
import 'fee_papers.dart';
import 'fee_pay.dart';

/// The child's fees as the web app's Fees page has them, on the phone and with no web page (docs/design/89,
/// "Fees in the app"): what is due now (school fee, hostel fee, other fees); each fee's instalments, ticked the
/// oldest first and paid online through the school's gateway; the other fees; every receipt (View, Download)
/// and online payment; the fee bill on screen and as PDF; and the tax certificate.
class FeesScreen extends ConsumerStatefulWidget {
  const FeesScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<FeesScreen> createState() => _FeesScreenState();
}

class _FeesScreenState extends ConsumerState<FeesScreen> {
  String _section = 'school';
  String? _paid;

  Profile get _p => widget.profile;

  void _afterPay(String? paid) {
    if (paid == null || !mounted) return;
    ref.invalidate(feesProvider(_p));
    ref.invalidate(miscFeesProvider(_p));
    ref.invalidate(feeIntentsProvider(_p));
    setState(() {
      _paid = paid;
      if (paid == '1') _section = 'receipts';
    });
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final p = _p;
    final misc = ref.watch(miscFeesProvider(p)).value?.data;
    return LoadedList<Json?>(
      value: ref.watch(feesProvider(p)),
      refresh: () {
        ref.invalidate(miscFeesProvider(p));
        ref.invalidate(feeIntentsProvider(p));
        return ref.refresh(feesProvider(p).future);
      },
      children: (c) {
        if (c == null) return [EmptyLine(s.noFees)];
        final fee = asJson(c['fee']);
        final hostel =
            fee['hosteller'] == true ||
            asList(c['instalments']).any((i) => i['ledger'] == 'hostel');
        final lines = asList(misc?['lines']);
        final open = [
          for (final l in lines)
            if (l['status'] != 'paid' &&
                l['blocked'] == null &&
                (num.tryParse('${l['balance']}') ?? 0) > 0)
              l,
        ];
        final dueSchool = num.tryParse('${c['payableSchool'] ?? c['payableNow']}') ?? 0;
        final dueHostel = num.tryParse('${c['payableHostel'] ?? 0}') ?? 0;
        final dueOther = open.fold<num>(0, (a, l) => a + (num.tryParse('${l['balance']}') ?? 0));
        final total = dueSchool + dueHostel + dueOther;
        final sections = ['school', if (hostel) 'hostel', 'other', 'receipts', 'bill'];
        final section = sections.contains(_section) ? _section : 'school';
        final label = {
          'school': s.schoolFee,
          'hostel': s.hostelFee,
          'other': s.otherFees,
          'receipts': s.receipts,
          'bill': s.feeBill,
        };
        void go(String to) => setState(() => _section = to);
        return [
          if (_paid != null) ...[
            Notice(text: _paid == '1' ? s.paymentDone : s.paymentNotDone),
            const SizedBox(height: Tokens.sp3),
          ],
          _Header(child: c),
          const SizedBox(height: Tokens.sp3),
          FigureGrid(
            tiles: [
              FigureTile(
                key: const Key('figDueNow'),
                label: '${s.dueNow} · ${s.lateFeeIncluded}',
                value: total > 0 ? s.money(total) : s.nothingDue,
                icon: Icons.payments_outlined,
                tone: total > 0 ? Tokens.statusWarning : null,
              ),
              FigureTile(
                key: const Key('figSchoolFee'),
                label: s.schoolFee,
                value: s.money(dueSchool),
                icon: Icons.school_outlined,
                onTap: () => go('school'),
              ),
              if (hostel)
                FigureTile(
                  key: const Key('figHostelFee'),
                  label: s.hostelFee,
                  value: s.money(dueHostel),
                  icon: Icons.bed_outlined,
                  onTap: () => go('hostel'),
                ),
              if (lines.isNotEmpty)
                FigureTile(
                  key: const Key('figOtherFees'),
                  label: s.otherFees,
                  value: s.money(dueOther),
                  icon: Icons.local_activity_outlined,
                  onTap: () => go('other'),
                ),
            ],
          ),
          const SizedBox(height: Tokens.sp4),
          Semantics(
            label: s.feeSections,
            container: true,
            explicitChildNodes: true,
            // chips that wrap: every section in view on a phone
            child: Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp2,
              children: [
                for (final x in sections)
                  ChoiceChip(
                    key: Key('section-$x'),
                    label: Text(label[x]!),
                    selected: x == section,
                    showCheckmark: false,
                    onSelected: (_) => go(x),
                  ),
              ],
            ),
          ),
          const SizedBox(height: Tokens.sp4),
          ...switch (section) {
            'school' ||
            'hostel' => _fee(s, c, section, section == 'hostel' ? dueHostel : dueSchool),
            'other' => _other(s, lines, open),
            'receipts' => _receipts(s, c, misc, hostel),
            _ => [_BillSection(profile: p, hostel: hostel)],
          },
          const SizedBox(height: Tokens.sp4),
          OutlinedButton.icon(
            key: const Key('taxCertificate'),
            icon: const Icon(Icons.verified_outlined),
            label: Text(s.taxCertificate),
            onPressed: () => pushPage(context, s.taxCertificate, TaxCertificateScreen(profile: p)),
          ),
        ];
      },
    );
  }

  /// One fee (school or hostel): its instalments with ticks, the gateways and Pay.
  List<Widget> _fee(S s, Json c, String ledger, num payable) {
    final p = _p;
    final rows = payRows(c, ledger);
    final fee = asJson(c['fee']);
    final active = asJson(c['year'])['status'] == 'active';
    final gateways = ref.watch(feeGatewaysProvider((p, ledger)));
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    String month(Object? iso) {
      final d = DateTime.tryParse('${iso ?? ''}');
      return d == null ? '' : s.month(d);
    }

    if (rows.isEmpty) return [EmptyLine(s.noDemand)];
    return [
      if (ledger == 'hostel' && (fee['hostelFrom'] != null || fee['hostelTo'] != null)) ...[
        Text(
          s.inHostel(
            fee['hostelFrom'] != null ? month(fee['hostelFrom']) : s.sessionStart,
            fee['hostelTo'] != null ? month(fee['hostelTo']) : s.sessionEnd,
          ),
          style: TextStyle(color: muted, fontSize: 14),
        ),
        const SizedBox(height: Tokens.sp2),
      ],
      PayPanel(
        key: ValueKey('pay-$ledger-${p.studentId}'),
        ledger: ledger,
        rows: rows,
        payable: payable.toDouble(),
        gateways: gateways.value,
        canPay: p.kind == 'parent' && active && gateways.hasValue,
        onPay: (amount, gatewayId) async => _afterPay(
          await payOnline(
            context,
            ref,
            (api) => api.paymentsCreateMine(
              body: CreateFamilyIntentDto(
                studentId: p.studentId!,
                amount: amount,
                ledger: ledger,
                gatewayId: gatewayId,
                app: 'mobile',
              ),
            ),
          ),
        ),
      ),
      if ((num.tryParse('${c['hidden'] ?? 0}') ?? 0) > 0) ...[
        const SizedBox(height: Tokens.sp2),
        Text(s.laterInstalments, style: TextStyle(color: muted, fontSize: 14)),
      ],
    ];
  }

  /// The other fees (a trip, an activity, a form): each paid in full online, or at the counter.
  List<Widget> _other(S s, List<Json> lines, List<Json> open) {
    final p = _p;
    final gateways = ref.watch(feeGatewaysProvider((p, 'misc'))).value;
    final canPay = p.kind == 'parent' && gateways != null && gateways.isNotEmpty;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;

    Future<void> pay(Json line) async {
      final gw = gateways!;
      String? id = gw.length == 1 ? '${gw.first['id']}' : null;
      id ??= await showModalBottomSheet<String>(
        context: context,
        showDragHandle: true,
        builder: (c) => SafeArea(
          child: ListView(
            shrinkWrap: true,
            children: [
              ListTile(title: Text(s.choosePayThrough, style: Theme.of(c).textTheme.titleMedium)),
              for (final g in gw)
                ListTile(
                  key: Key('miscGateway-${g['id']}'),
                  title: Text('${g['label']}'),
                  subtitle: Text(
                    chargeText(s, g).isEmpty ? s.noCharge : s.convenienceCharge(chargeText(s, g)),
                  ),
                  onTap: () => Navigator.of(c).pop('${g['id']}'),
                ),
            ],
          ),
        ),
      );
      if (id == null || !mounted) return;
      _afterPay(
        await payOnline(
          context,
          ref,
          (api) => api.paymentsCreateMineMisc(
            body: CreateFamilyMiscIntentDto(lineId: '${line['id']}', gatewayId: id, app: 'mobile'),
          ),
        ),
      );
    }

    return [
      Text(
        canPay ? s.miscHelpPay : s.miscHelpCounter,
        style: TextStyle(color: muted, fontSize: 14),
      ),
      const SizedBox(height: Tokens.sp3),
      if (lines.isEmpty)
        EmptyLine(s.noOtherFees)
      else
        Card(
          child: Column(
            children: [
              for (var i = 0; i < lines.length; i++)
                Container(
                  decoration: BoxDecoration(
                    border: i + 1 < lines.length
                        ? Border(
                            bottom: BorderSide(color: dark ? Tokens.mobGray700 : Tokens.mobGray100),
                          )
                        : null,
                  ),
                  padding: const EdgeInsets.all(Tokens.sp4),
                  child: _miscLine(s, lines[i], muted, canPay && open.contains(lines[i]), pay),
                ),
            ],
          ),
        ),
    ];
  }

  Widget _miscLine(S s, Json l, Color muted, bool payable, Future<void> Function(Json) pay) {
    final seats = l['seats'] as num?;
    return Column(
      key: Key('misc-${l['id']}'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('${l['title']}', style: const TextStyle(fontWeight: Tokens.fwBold, fontSize: 16)),
        Text(
          [
            s.lastDate(s.date(l['lastDate'])),
            s.amountOf(s.money(l['amount'])),
            if ((num.tryParse('${l['paid']}') ?? 0) > 0) s.paidOf(s.money(l['paid'])),
            l['mandatory'] == true ? s.mandatory : s.optional,
            if (seats != null) s.seatsOf((l['seatsTaken'] as num? ?? 0).toInt(), seats.toInt()),
            if (l['remark'] != null) '${l['remark']}',
          ].join(' · '),
          style: TextStyle(color: muted, fontSize: 14),
        ),
        const SizedBox(height: Tokens.sp2),
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            if (l['status'] == 'paid')
              StatusChip(s.paid, Tone.success)
            else if (l['blocked'] != null)
              StatusChip('${l['blocked']}', Tone.neutral)
            else
              StatusChip(s.toPayOf(s.money(l['balance'])), Tone.warning),
            if (payable)
              FilledButton.icon(
                key: Key('payMisc-${l['id']}'),
                style: FilledButton.styleFrom(minimumSize: const Size(48, 44)),
                icon: const Icon(Icons.lock_outline, size: 18),
                label: Text(s.payOnlineOf(s.money(l['balance']))),
                onPressed: () => pay(l),
              ),
          ],
        ),
      ],
    );
  }

  /// Every receipt of the session by fee type — the school fee, the hostel fee (a hosteller, or one with hostel
  /// receipts), the other fees (their own receipt series) — each with View and Download, then the online payments.
  List<Widget> _receipts(S s, Json c, Json? misc, bool hostel) {
    final p = _p;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    int newest(Json a, Json b) => '${b['receivedOn']}'.compareTo('${a['receivedOn']}');
    final payments = asList(c['payments'])..sort(newest);
    final school = [
      for (final x in payments)
        if (x['ledger'] != 'hostel') x,
    ];
    final hostelRows = [
      for (final x in payments)
        if (x['ledger'] == 'hostel') x,
    ];
    final other = asList(misc?['receipts'])..sort(newest);
    final intents = ref.watch(feeIntentsProvider(p)).value ?? const <Json>[];
    // a cancelled or bounced receipt does not count; a refund comes off
    num received(List<Json> rows) => rows.fold<num>(
      0,
      (a, r) => ['bounced', 'reversed', 'cancelled'].contains('${r['status']}')
          ? a
          : a +
                (num.tryParse('${r['amount']}') ?? 0) -
                (num.tryParse('${r['refunded'] ?? 0}') ?? 0),
    );
    Widget card(List<Json> rows, bool isMisc) => rows.isEmpty
        ? EmptyLine(s.noReceipts)
        : Card(
            child: Column(
              children: [
                for (var i = 0; i < rows.length; i++)
                  Container(
                    decoration: BoxDecoration(
                      border: i + 1 < rows.length
                          ? Border(
                              bottom: BorderSide(
                                color: dark ? Tokens.mobGray700 : Tokens.mobGray100,
                              ),
                            )
                          : null,
                    ),
                    padding: const EdgeInsets.fromLTRB(
                      Tokens.sp4,
                      Tokens.sp3,
                      Tokens.sp1,
                      Tokens.sp3,
                    ),
                    child: _receipt(s, rows[i], muted, misc: isMisc),
                  ),
              ],
            ),
          );
    final groups = <(String, String, List<Json>, bool)>[
      ('school', s.schoolFee, school, false),
      if (hostel || hostelRows.isNotEmpty) ('hostel', s.hostelFee, hostelRows, false),
      if (other.isNotEmpty || asList(misc?['lines']).isNotEmpty)
        ('other', s.otherFees, other, true),
    ];
    return [
      for (final (key, label, rows, isMisc) in groups) ...[
        SectionTitle(
          '$label · ${s.receiptsOf(rows.length)} · ${s.receivedOf(s.money(received(rows)))}',
          key: Key('receipts-$key'),
        ),
        card(rows, isMisc),
      ],
      if (intents.isNotEmpty) ...[
        SectionTitle(s.onlinePayments),
        Card(
          child: Column(
            children: [
              for (final x in intents)
                ListTile(
                  key: Key('intent-${x['id']}'),
                  title: Text(s.money(x['amount'])),
                  subtitle: Text(
                    [
                      if (DateTime.tryParse('${x['createdAt']}') != null)
                        s.dateTime(DateTime.parse('${x['createdAt']}')),
                      '${x['txnId']}',
                    ].join(' · '),
                  ),
                  trailing: StatusChip(s.intentStatus('${x['status']}'), switch ('${x['status']}') {
                    'succeeded' => Tone.success,
                    'failed' => Tone.danger,
                    'expired' || 'cancelled' => Tone.neutral,
                    _ => Tone.warning,
                  }),
                ),
            ],
          ),
        ),
      ],
    ];
  }

  Widget _receipt(S s, Json pay, Color muted, {bool misc = false}) {
    final refunded = num.tryParse('${pay['refunded'] ?? 0}') ?? 0;
    final status = '${pay['status'] ?? 'posted'}';
    final late = num.tryParse('${pay['lateFee'] ?? 0}') ?? 0;
    final no = '${pay['receiptNo'] ?? '—'}';
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Wrap(
                spacing: Tokens.sp2,
                runSpacing: Tokens.sp1,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Text(no, style: const TextStyle(fontWeight: Tokens.fwBold, fontSize: 16)),
                  if (status == 'bounced')
                    Tag(s.bounced, color: Tokens.statusDangerBg)
                  else if (status != 'posted' && refunded > 0)
                    Tag(
                      status == 'partly_refunded'
                          ? s.partlyRefundedOf(s.money(refunded))
                          : s.refundedOf(s.money(refunded)),
                      color: Tokens.statusWarningBg,
                    )
                  else if (status != 'posted')
                    Tag(s.cancelledTag, color: Tokens.mobGray100),
                ],
              ),
              Text(
                [
                  if (misc && pay['title'] != null) '${pay['title']}',
                  s.date(pay['receivedOn']),
                  '${pay['mode']}'.toUpperCase(),
                  late > 0
                      ? '${s.money(pay['amount'])} (${s.lateFee(s.money(late))})'
                      : s.money(pay['amount']),
                  if (pay['clearedOn'] != null)
                    s.clearedOn(s.date(pay['clearedOn']))
                  else if (pay['settled'] == true)
                    s.settled,
                ].join(' · '),
                style: TextStyle(color: muted, fontSize: 14),
              ),
            ],
          ),
        ),
        FileIcons(
          name: '${misc ? 'miscReceipt' : 'receipt'}-${pay['id']}',
          label: s.receiptNo(no),
          load: () => misc
              ? ref.read(apiProvider).miscFeesMyReceiptFile(id: '${pay['id']}')
              : ref.read(apiProvider).feesMyReceiptFile(paymentId: '${pay['id']}'),
        ),
      ],
    );
  }
}

/// Who and what the fees are for: the child, the class and session, the pay plan, hostel, transport, discounts.
class _Header extends ConsumerWidget {
  const _Header({required this.child});
  final Json child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final st = asJson(child['student']);
    final fee = asJson(child['fee']);
    final year = asJson(child['year']);
    final discounts = [for (final d in (fee['discounts'] as List? ?? const [])) '$d'];
    final tags = <Widget>[
      if (fee['payPlan'] != null) Tag(s.payPlan('${fee['payPlan']}')),
      if (fee['hosteller'] == true) Tag(s.hosteller, color: Tokens.mobGray100),
      if (fee['transport'] != null)
        Tag(s.transportOf('${fee['transport']}'), color: Tokens.mobGray100),
      if (discounts.isNotEmpty)
        Tag(s.discountOf(discounts.join(', ')), color: Tokens.statusSuccessBg),
    ];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              [
                '${st['name'] ?? ''}',
                if (st['section'] != null) '${st['section']}',
                if (year['code'] != null) '${year['code']}',
              ].join(' · '),
              style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
            ),
            if (tags.isNotEmpty) ...[
              const SizedBox(height: Tokens.sp2),
              Wrap(spacing: Tokens.sp2, runSpacing: Tokens.sp2, children: tags),
            ],
          ],
        ),
      ),
    );
  }
}

/// The fee bill section: All / Regular / Hostel (for a hosteller), the bill on screen, its PDF.
class _BillSection extends ConsumerStatefulWidget {
  const _BillSection({required this.profile, required this.hostel});
  final Profile profile;
  final bool hostel;

  @override
  ConsumerState<_BillSection> createState() => _BillSectionState();
}

class _BillSectionState extends ConsumerState<_BillSection> {
  late String _ledger = widget.hostel ? 'all' : 'school';

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final p = widget.profile;
    final bill = ref.watch(feeBillProvider((p, _ledger)));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.hostel) ...[
          // chips that wrap (large text): all fees, the regular (school) fee, the hostel fee
          Wrap(
            key: const Key('billLedger'),
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp2,
            children: [
              for (final (v, t) in [
                ('all', s.billAll),
                ('school', s.billRegular),
                ('hostel', s.billHostel),
              ])
                ChoiceChip(
                  key: Key('billLedger-$v'),
                  label: Text(t),
                  selected: _ledger == v,
                  showCheckmark: false,
                  onSelected: (_) => setState(() => _ledger = v),
                ),
            ],
          ),
          const SizedBox(height: Tokens.sp2),
        ],
        Row(
          children: [
            Expanded(child: Text(s.feeBill, style: Theme.of(context).textTheme.titleMedium)),
            FileIcons(
              name: 'feeBill',
              label: s.feeBill,
              load: () =>
                  ref.read(apiProvider).feesMyBillFile(studentId: p.studentId!, ledger: _ledger),
            ),
          ],
        ),
        const SizedBox(height: Tokens.sp3),
        switch (bill) {
          AsyncValue(:final value?) => FeeBillView(bill: value.data),
          AsyncValue(hasError: true) => Notice(text: s.billNotMade),
          _ => Center(
            child: Padding(
              padding: const EdgeInsets.all(Tokens.sp5),
              child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
            ),
          ),
        },
      ],
    );
  }
}
