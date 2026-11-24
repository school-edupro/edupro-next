import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart' show ApiFile;

import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/file_screen.dart';
import '../ui/widgets.dart';
import 'data.dart';

/// The words of My payslips (as the staff website's, in English and Hindi).
extension PayslipWords on S {
  String _ps(String en, String hi) => hindi ? hi : en;

  String psPassword(String hint) => _ps(
    'Each payslip opens with a password: $hint.',
    'हर वेतन पर्ची पासवर्ड से खुलती है: $hint।',
  );
  String get psLocked => _ps(
    'Your payslips appear here once the month’s pay is locked.',
    'महीने का वेतन लॉक होने पर आपकी वेतन पर्चियाँ यहाँ दिखेंगी।',
  );
  String get psCount => _ps('Payslips this year', 'इस वर्ष की वेतन पर्चियाँ');
  String get psGross => _ps('Gross so far', 'अब तक सकल');
  String get psTax => _ps('Income tax so far', 'अब तक आयकर');
  String get psNet => _ps('Net so far', 'अब तक शुद्ध');
  String get psList => _ps('Payslips', 'वेतन पर्चियाँ');
  String get psNone => _ps('No payslip yet this year.', 'इस वर्ष अभी कोई वेतन पर्ची नहीं।');
  String psRun(String t) => t == 'BONUS' ? _ps('Bonus', 'बोनस') : _ps('Supplementary', 'पूरक');
  String get psHeld => _ps('Payment held', 'भुगतान रोका गया');
  String get psGrossWord => _ps('Gross', 'सकल');
  String get psDeductions => _ps('Deductions', 'कटौतियाँ');
  String psOf(String month) => _ps('The payslip of $month', '$month की वेतन पर्ची');
  String get psPapers => _ps('Letters and certificate', 'पत्र और प्रमाणपत्र');
  String psSalaryCert(String fy) => _ps('Salary certificate $fy', 'वेतन प्रमाणपत्र $fy');
  String psLetter(String kind, String no, String from) => kind == 'INCREMENT'
      ? _ps('Increment letter $no, from $from', 'वेतनवृद्धि पत्र $no, $from से')
      : _ps('Pay revision letter $no, from $from', 'वेतन संशोधन पत्र $no, $from से');
  String get psNoLetters => _ps(
    'No increment or pay revision letter yet.',
    'अभी कोई वेतनवृद्धि या वेतन संशोधन पत्र नहीं।',
  );
}

/// My increment and pay revision letters.
final myPayLettersProvider = FutureProvider.autoDispose.family<List<Json>, Profile>((ref, p) async {
  try {
    return asList(asJson(await ref.read(apiProvider).payrollPeopleDocsMyLetters())['rows']);
  } catch (_) {
    return const [];
  }
});

/// My payslips as on the staff website (docs/design/86, phase B): the password rule, the financial year, the year so
/// far (payslips, gross, income tax, net), each payslip with its net, gross and deductions (a bonus or supplementary
/// run and a held payment marked) to view or download, and the salary certificate and my increment / revision letters.
class PayslipsScreen extends ConsumerStatefulWidget {
  const PayslipsScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<PayslipsScreen> createState() => _PayslipsScreenState();
}

class _PayslipsScreenState extends ConsumerState<PayslipsScreen> {
  String _fy = financialYear(schoolToday());

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final arg = (widget.profile, _fy);
    final api = ref.read(apiProvider);
    final letters = ref.watch(myPayLettersProvider(widget.profile)).value ?? const <Json>[];
    return LoadedList<Json>(
      value: ref.watch(payslipsProvider(arg)),
      refresh: () => ref.refresh(payslipsProvider(arg).future),
      children: (m) {
        final years = [for (final y in (m['years'] as List? ?? const [])) '$y'];
        final rows = asList(m['rows']);
        final ytd = asJson(m['ytd']);
        final hint = m['passwordHint'] as String?;
        final fy = m['fy'] == null ? _fy : '${m['fy']}';
        final dark = Theme.of(context).brightness == Brightness.dark;
        final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
        return [
          Text(
            hint != null ? s.psPassword(hint) : s.psLocked,
            style: TextStyle(color: muted, fontSize: 14),
          ),
          const SizedBox(height: Tokens.sp2),
          if (years.length > 1)
            DropdownMenu<String>(
              key: const Key('payslipYear'),
              label: Text(s.financialYearLabel),
              trailingIcon: dropArrow(s.financialYearLabel),
              selectedTrailingIcon: dropArrow(s.financialYearLabel, open: true),
              enableFilter: true,
              enableSearch: true,
              requestFocusOnTap: true,
              initialSelection: _fy,
              onSelected: (v) => setState(() => _fy = v ?? _fy),
              dropdownMenuEntries: [
                for (final y in years) DropdownMenuEntry(value: y, label: s.fy(y)),
              ],
            ),
          const SizedBox(height: Tokens.sp3),
          FigureGrid(
            key: const Key('payslipFigures'),
            tiles: [
              FigureTile(
                label: s.psCount,
                value: '${ytd['count'] ?? 0}',
                icon: Icons.receipt_long_outlined,
              ),
              FigureTile(
                label: s.psGross,
                value: s.money(ytd['gross']),
                icon: Icons.payments_outlined,
              ),
              FigureTile(
                label: s.psTax,
                value: s.money(ytd['tax']),
                icon: Icons.account_balance_outlined,
              ),
              FigureTile(label: s.psNet, value: s.money(ytd['net']), icon: Icons.savings_outlined),
            ],
          ),
          const SizedBox(height: Tokens.sp3),
          Semantics(
            header: true,
            child: Text(
              s.psList,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
            ),
          ),
          const SizedBox(height: Tokens.sp2),
          if (rows.isEmpty) EmptyLine(s.psNone),
          for (final r in rows)
            () {
              final month = s.month(DateTime.parse('${r['month']}-01'));
              Future<ApiFile> load() => api.payrollPayslipMinePdf(recordId: '${r['id']}');
              return Card(
                key: Key('payslip-${r['id']}'),
                margin: const EdgeInsets.only(bottom: Tokens.sp2),
                child: Padding(
                  padding: const EdgeInsets.all(Tokens.sp3),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Wrap(
                        spacing: Tokens.sp2,
                        runSpacing: Tokens.sp1,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(month, style: const TextStyle(fontWeight: Tokens.fwBold)),
                          if (r['runType'] != null && r['runType'] != 'REGULAR')
                            StatusChip(s.psRun('${r['runType']}'), Tone.info),
                          if (r['status'] == 'HELD') StatusChip(s.psHeld, Tone.warning),
                        ],
                      ),
                      FactLine(s.net, s.money(r['netPay']), strong: true),
                      FactLine(s.psGrossWord, s.money(r['grossEarned'])),
                      FactLine(s.psDeductions, s.money(r['totalDeductions'])),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.end,
                        children: [
                          IconButton(
                            key: Key('view-payslip-${r['id']}'),
                            tooltip: '${s.view} ${s.psOf(month)}',
                            icon: const Icon(Icons.visibility_outlined),
                            onPressed: () => Navigator.of(context).push(
                              MaterialPageRoute<void>(
                                builder: (_) =>
                                    FileScreen(title: month, passwordHint: hint, load: load),
                              ),
                            ),
                          ),
                          IconButton(
                            key: Key('download-payslip-${r['id']}'),
                            tooltip: '${s.download} ${s.psOf(month)}',
                            icon: const Icon(Icons.download_outlined),
                            onPressed: () => shareFile(context, s, load),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            }(),
          const SizedBox(height: Tokens.sp2),
          Card(
            key: const Key('payslipPapers'),
            child: Padding(
              padding: const EdgeInsets.all(Tokens.sp3),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Semantics(
                    header: true,
                    child: Text(
                      s.psPapers,
                      style: Theme.of(context).textTheme.titleMedium
                          ?.copyWith(fontWeight: Tokens.fwBold),
                    ),
                  ),
                  if (rows.isNotEmpty)
                    Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(s.psSalaryCert(s.fy(fy))),
                        FileIcons(
                          label: s.psSalaryCert(s.fy(fy)),
                          name: 'salcert-$fy',
                          load: () => api.payrollPeopleDocsMyCertificate(fy: s.fy(fy)),
                        ),
                      ],
                    ),
                  if (letters.isEmpty)
                    Text(s.psNoLetters, style: TextStyle(color: muted, fontSize: 13)),
                  for (final l in letters)
                    Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(
                          s.psLetter(
                            '${l['kind']}',
                            '${l['letterNo']}',
                            s.date(l['effectiveFrom'] ?? ''),
                          ),
                        ),
                        FileIcons(
                          label: '${l['letterNo']}',
                          name: 'letter-${l['id']}',
                          load: () => api.payrollPeopleDocsMyLetter(id: '${l['id']}'),
                        ),
                      ],
                    ),
                ],
              ),
            ),
          ),
        ];
      },
    );
  }
}
