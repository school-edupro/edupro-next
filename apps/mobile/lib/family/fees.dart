import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/file_screen.dart';
import '../ui/web_page_screen.dart';
import '../ui/widgets.dart';
import 'common.dart';
import 'data.dart';

Tone instalmentTone(String status) => switch (status) {
  'paid' => Tone.success,
  'overdue' => Tone.danger,
  'due' => Tone.warning,
  _ => Tone.neutral,
};

/// The child's fees: what to pay now (online, through the school's gateway in the web view), the instalments,
/// the receipts as PDF, the fee bill and the certificate for tax.
class FeesScreen extends ConsumerStatefulWidget {
  const FeesScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<FeesScreen> createState() => _FeesScreenState();
}

class _FeesScreenState extends ConsumerState<FeesScreen> {
  String? _paid;

  Future<void> _pay() async {
    final s = ref.read(stringsProvider);
    final back = await Navigator.of(context).push<Uri>(
      MaterialPageRoute(
        builder: (_) => WebPageScreen(
          app: 'parent',
          to: '/fees',
          title: s.payNow,
          // the gateway returns to the web app's /fees?paid=…
          doneWhen: (u) => u.path == '/fees' && u.queryParameters.containsKey('paid'),
        ),
      ),
    );
    ref.invalidate(feesProvider(widget.profile));
    if (back != null && mounted) setState(() => _paid = back.queryParameters['paid']);
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final p = widget.profile;
    return LoadedList<Json?>(
      value: ref.watch(feesProvider(p)),
      refresh: () => ref.refresh(feesProvider(p).future),
      children: (ledger) {
        if (ledger == null) return [EmptyLine(s.noFees)];
        final totals = asJson(ledger['totals']);
        final payable = num.tryParse('${ledger['payableNow']}') ?? 0;
        final instalments = asList(ledger['instalments'])
            .where((i) => i['visible'] != false)
            .toList();
        final payments = asList(ledger['payments'])
          ..sort((a, b) => '${b['receivedOn']}'.compareTo('${a['receivedOn']}'));
        return [
          if (_paid != null) ...[
            Notice(text: _paid == '1' ? s.paymentDone : s.paymentNotDone),
            const SizedBox(height: Tokens.sp3),
          ],
          FigureGrid(
            tiles: [
              FigureTile(
                label: s.payableNow,
                value: payable > 0 ? s.money(payable) : s.nothingDue,
                icon: Icons.payments_outlined,
              ),
              FigureTile(
                label: s.balance,
                value: s.money(totals['balance']),
                icon: Icons.account_balance_wallet_outlined,
              ),
            ],
          ),
          if (payable > 0)
            FilledButton.icon(
              key: const Key('payNow'),
              icon: const Icon(Icons.lock_outline),
              label: Text('${s.payNow} · ${s.money(payable)}'),
              onPressed: p.kind == 'parent' ? _pay : null,
            ),
          SectionTitle(s.instalments),
          if (instalments.isEmpty) EmptyLine(s.nothingYet),
          if (instalments.isNotEmpty)
            Card(
              child: Column(
                children: [
                  for (final i in instalments)
                    ListTile(
                      title: Text('${i['label']}'),
                      subtitle: Text(
                        [
                          s.dueOn(s.date(i['dueOn'])),
                          s.money(i['net']),
                          if ((num.tryParse('${asJson(i['lateFee'])['outstanding']}') ?? 0) > 0)
                            s.lateFee(s.money(asJson(i['lateFee'])['outstanding'])),
                        ].join(' · '),
                      ),
                      trailing: StatusChip(
                        s.instalmentStatus('${i['status']}'),
                        instalmentTone('${i['status']}'),
                      ),
                    ),
                ],
              ),
            ),
          SectionTitle(s.receipts),
          if (payments.isEmpty) EmptyLine(s.nothingYet),
          if (payments.isNotEmpty)
            Card(
              child: Column(
                children: [
                  for (final pay in payments)
                    ListTile(
                      key: Key('receipt-${pay['id']}'),
                      leading: const Icon(Icons.receipt_long_outlined),
                      title: Text(
                        pay['receiptNo'] == null ? s.paid : s.receiptNo('${pay['receiptNo']}'),
                      ),
                      subtitle: Text(
                        '${s.date(pay['receivedOn'])} · ${s.money(pay['amount'])} · ${pay['mode']}',
                      ),
                      trailing: const Icon(Icons.visibility_outlined),
                      onTap: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => FileScreen(
                            title: s.receiptNo('${pay['receiptNo'] ?? ''}'),
                            load: () =>
                                ref.read(apiProvider).feesMyReceiptFile(paymentId: '${pay['id']}'),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          const SizedBox(height: Tokens.sp3),
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp2,
            children: [
              OutlinedButton.icon(
                key: const Key('feeBill'),
                icon: const Icon(Icons.description_outlined),
                label: Text(s.feeBill),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => FileScreen(
                      title: s.feeBill,
                      load: () => ref.read(apiProvider).feesMyBillFile(studentId: p.studentId!),
                    ),
                  ),
                ),
              ),
              OutlinedButton.icon(
                icon: const Icon(Icons.verified_outlined),
                label: Text(s.taxCertificate),
                onPressed: () => context.push(
                  Uri(
                    path: '/web',
                    queryParameters: {
                      'app': 'parent',
                      'to': '/fees/tax-certificate',
                      'title': s.taxCertificate,
                    },
                  ).toString(),
                ),
              ),
            ],
          ),
        ];
      },
    );
  }
}
