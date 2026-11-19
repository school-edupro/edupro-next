import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'common.dart';
import 'data.dart';

/// The fee bill and the tax certificate on the phone's screen, each with View and Download of its PDF
/// (docs/design/89, "Fees in the app"; the same facts as the web app's printed sheets).

/// The fee bill of the session: the particulars, the fee heads, each fee's instalments with what is paid and
/// still to pay, the receipts and the summary with the balance in words.
class FeeBillView extends ConsumerWidget {
  const FeeBillView({super.key, required this.bill});
  final Json bill;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    final st = asJson(bill['student']);
    final session = asJson(bill['session']);
    final heads = asList(bill['heads']);
    final summary = asJson(bill['summary']);
    final discount = num.tryParse('${bill['discount']}') ?? 0;
    String month(Object? iso) {
      final d = DateTime.tryParse('$iso');
      return d == null ? '' : s.month(d);
    }

    return Column(
      key: const Key('feeBill'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(Tokens.sp4),
            child: Column(
              children: [
                FactLine(s.billNo, '${bill['billNo'] ?? ''}'),
                FactLine(s.billDate, s.date(bill['billDate'] ?? '')),
                if (session['from'] != null)
                  FactLine(s.sessionLabel, '${month(session['from'])} – ${month(session['to'])}'),
                FactLine(s.studentLabel, '${st['name'] ?? ''}'),
                FactLine(s.admissionNoLabel, '${st['admissionNo'] ?? ''}'),
                if (st['section'] != null) FactLine(s.classLabel, '${st['section']}'),
                if (st['guardian'] != null) FactLine(s.guardianLabel, '${st['guardian']}'),
                if (st['route'] != null) FactLine(s.routeLabel, '${st['route']}'),
              ],
            ),
          ),
        ),
        if (heads.isNotEmpty) ...[
          SectionTitle(s.feeForSession),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(Tokens.sp4),
              child: Column(
                children: [
                  for (final h in heads)
                    FactLine(
                      h['optional'] == true ? '${h['head']} (${s.optionalHead})' : '${h['head']}',
                      s.money(h['amount']),
                    ),
                  if (discount > 0) FactLine(s.discountLabel, '− ${s.money(discount)}'),
                ],
              ),
            ),
          ),
        ],
        for (final sc in asList(bill['schedules'])) ...[
          SectionTitle(
            '${s.scheduleOf('${sc['ledger']}')} · ${s.payPlan('${sc['payPlan']}').split(': ').last}',
          ),
          Card(
            child: Column(
              children: [
                for (final r in asList(sc['rows']))
                  ListTile(
                    title: Text('${r['no']} · ${r['months']}'),
                    subtitle: Text(
                      [
                        s.dueOn(s.date(r['dueOn'])),
                        '${s.payableCol} ${s.money(r['payable'])}',
                        '${s.paid} ${s.money(r['paid'])}',
                        if ((num.tryParse('${r['lateFee']}') ?? 0) > 0)
                          s.lateFee(s.money(r['lateFee'])),
                      ].join(' · '),
                    ),
                    trailing: Text(
                      s.money(r['balance']),
                      style: const TextStyle(fontWeight: Tokens.fwBold),
                    ),
                  ),
              ],
            ),
          ),
        ],
        if (asList(bill['receipts']).isNotEmpty) ...[
          SectionTitle(s.receipts),
          Card(
            child: Column(
              children: [
                for (final r in asList(bill['receipts']))
                  ListTile(
                    title: Text('${r['receiptNo'] ?? '—'}'),
                    subtitle: Text(
                      [
                        s.date(r['receivedOn']),
                        '${r['mode']}'.toUpperCase(),
                        if (r['counted'] == false) s.cancelledTag,
                      ].join(' · '),
                    ),
                    trailing: Text(s.money(r['finalAmount'] ?? r['amount'])),
                  ),
              ],
            ),
          ),
        ],
        SectionTitle(s.summary),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(Tokens.sp4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                FactLine(s.dueLabel, s.money(summary['due'])),
                if ((num.tryParse('${summary['lateFee']}') ?? 0) > 0)
                  FactLine(s.lateFee('').trim(), s.money(summary['lateFee'])),
                FactLine(s.receivedLabel, s.money(summary['received'])),
                if ((num.tryParse('${summary['refund']}') ?? 0) > 0)
                  FactLine(s.refundLabel, s.money(summary['refund'])),
                if ((num.tryParse('${summary['advance']}') ?? 0) > 0)
                  FactLine(s.advanceLabel, s.money(summary['advance'])),
                FactLine(s.balanceLabel, s.money(summary['balance']), strong: true),
                if (summary['balanceWords'] != null) ...[
                  const SizedBox(height: Tokens.sp1),
                  Text('${summary['balanceWords']}', style: TextStyle(color: muted, fontSize: 14)),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// The certificate of fee paid in a financial year, for the parent's income-tax return: the year to choose,
/// the receipts that count, the total in words, and the PDF to view or save.
class TaxCertificateScreen extends ConsumerStatefulWidget {
  const TaxCertificateScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<TaxCertificateScreen> createState() => _TaxCertificateScreenState();
}

class _TaxCertificateScreenState extends ConsumerState<TaxCertificateScreen> {
  String? _year;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final p = widget.profile;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    final value = ref.watch(taxCertificateProvider((p, _year)));
    if (value.hasError && !value.hasValue) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(Tokens.sp5),
          child: Notice(text: s.taxNotAvailable),
        ),
      );
    }
    return LoadedList<Json>(
      value: value,
      refresh: () => ref.refresh(taxCertificateProvider((p, _year)).future),
      children: (c) {
        final fy = asJson(c['financialYear']);
        final st = asJson(c['student']);
        final school = asJson(c['school']);
        final rows = asList(c['rows']);
        return [
          Text(s.taxHelp, style: TextStyle(color: muted, fontSize: 14)),
          const SizedBox(height: Tokens.sp4),
          Row(
            children: [
              Expanded(
                child: DropdownMenu<String>(
                  key: const Key('taxYear'),
                  label: Text(s.financialYear),
                  initialSelection: '${fy['id']}',
                  trailingIcon: dropArrow(s.financialYear),
                  selectedTrailingIcon: dropArrow(s.financialYear, open: true),
                  expandedInsets: EdgeInsets.zero,
                  enableFilter: true,
                  enableSearch: true,
                  requestFocusOnTap: true,
                  onSelected: (v) => setState(() => _year = v),
                  dropdownMenuEntries: [
                    for (final y in asList(c['years']))
                      DropdownMenuEntry(value: '${y['id']}', label: '${y['name']}'),
                  ],
                ),
              ),
              FileIcons(
                name: 'taxCertificate',
                label: s.taxCertificate,
                load: () => ref
                    .read(apiProvider)
                    .feesMyTaxCertificateFile(
                      studentId: p.studentId!,
                      financialYearId: '${fy['id']}',
                    ),
              ),
            ],
          ),
          const SizedBox(height: Tokens.sp4),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(Tokens.sp4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    '${school['name'] ?? ''}',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.titleMedium
                        ?.copyWith(fontWeight: Tokens.fwBold),
                  ),
                  if ('${school['address'] ?? ''}'.isNotEmpty)
                    Text(
                      '${school['address']}',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: muted, fontSize: 13),
                    ),
                  const SizedBox(height: Tokens.sp2),
                  Text(
                    s.taxCertificate,
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontWeight: Tokens.fwBold),
                  ),
                  const Divider(height: Tokens.sp5),
                  FactLine(s.studentLabel, '${st['name'] ?? ''}'),
                  FactLine(s.admissionNoLabel, '${st['admissionNo'] ?? ''}'),
                  FactLine(s.classLabel, '${st['section'] ?? '—'}'),
                  FactLine(s.guardianLabel, '${st['guardian'] ?? '—'}'),
                  FactLine(
                    s.financialYear,
                    '${fy['name']} (${s.date(fy['from'])} – ${s.date(fy['to'])})',
                  ),
                  FactLine(s.issuedOn, s.date(c['issuedOn'] ?? '')),
                  const SizedBox(height: Tokens.sp3),
                  Text(s.taxCertifies),
                  const SizedBox(height: Tokens.sp2),
                  if (rows.isEmpty)
                    Text(s.noTaxFee, style: const TextStyle(fontWeight: Tokens.fwBold))
                  else ...[
                    for (final r in rows)
                      Padding(
                        padding: const EdgeInsets.symmetric(vertical: Tokens.sp1),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    '${r['head']}',
                                    style: const TextStyle(fontWeight: Tokens.fwSemibold),
                                  ),
                                  Text(
                                    [
                                      s.date(r['receivedOn']),
                                      if (r['receiptNo'] != null) '${r['receiptNo']}',
                                      '${r['mode']}'.toUpperCase(),
                                    ].join(' · '),
                                    style: TextStyle(color: muted, fontSize: 13),
                                  ),
                                ],
                              ),
                            ),
                            Text(s.money(r['amount'])),
                          ],
                        ),
                      ),
                    const Divider(),
                    FactLine(s.totalLabel, s.money(c['total']), strong: true),
                    FactLine(s.amountInWords, '${c['totalWords'] ?? ''}'),
                  ],
                  const SizedBox(height: Tokens.sp2),
                  Text(s.computerMade, style: TextStyle(color: muted, fontSize: 13)),
                ],
              ),
            ),
          ),
        ];
      },
    );
  }
}
