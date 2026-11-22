import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/file_screen.dart';
import '../ui/widgets.dart';
import 'data.dart';

/// The person's week, a day at a time.
class StaffTimetable extends ConsumerStatefulWidget {
  const StaffTimetable({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<StaffTimetable> createState() => _StaffTimetableState();
}

class _StaffTimetableState extends ConsumerState<StaffTimetable> {
  int _day = schoolToday().weekday == 7 ? 1 : schoolToday().weekday;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final p = widget.profile;
    return LoadedList<Json>(
      value: ref.watch(myWeekProvider(p)),
      refresh: () => ref.refresh(myWeekProvider(p).future),
      children: (w) {
        final periods = {for (final x in asList(w['periods'])) '${x['id']}': x};
        final slots = asList(w['slots']).where((x) => x['weekday'] == _day).toList()
          ..sort(
            (a, b) =>
                ((a['periodNumber'] as num?) ?? 0).compareTo((b['periodNumber'] as num?) ?? 0),
          );
        return [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: SegmentedButton<int>(
              showSelectedIcon: false,
              segments: [
                for (var d = 1; d <= 6; d++) ButtonSegment(value: d, label: Text(s.weekday(d))),
              ],
              selected: {_day},
              onSelectionChanged: (v) => setState(() => _day = v.first),
            ),
          ),
          const SizedBox(height: Tokens.sp3),
          if (slots.isEmpty) EmptyLine(s.noPeriods),
          for (final x in slots)
            Card(
              child: ListTile(
                leading: CircleAvatar(child: Text('${x['periodNumber'] ?? ''}')),
                title: Text('${x['classCode']}-${x['section']} · ${x['subjectName'] ?? ''}'),
                subtitle: Text(
                  [
                    if (x['room'] != null) '${x['room']}',
                    if (periods['${x['periodId']}'] != null)
                      '${s.time(periods['${x['periodId']}']!['startsAt'] as String?)}–${s.time(periods['${x['periodId']}']!['endsAt'] as String?)}',
                  ].join(' · '),
                ),
              ),
            ),
        ];
      },
    );
  }
}

/// The person's payslips of a financial year; each opens as its PDF (password protected, the hint shown).
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
    return LoadedList<Json>(
      value: ref.watch(payslipsProvider(arg)),
      refresh: () => ref.refresh(payslipsProvider(arg).future),
      children: (m) {
        final years = [for (final y in (m['years'] as List? ?? const [])) '$y'];
        final rows = asList(m['rows']);
        return [
          if (years.length > 1)
            DropdownMenu<String>(
              key: const Key('payslipYear'),
              label: Text(s.financialYearLabel),
              trailingIcon: dropArrow(s.financialYearLabel),
              selectedTrailingIcon: dropArrow(s.financialYearLabel, open: true),
              initialSelection: _fy,
              onSelected: (v) => setState(() => _fy = v ?? _fy),
              dropdownMenuEntries: [
                for (final y in years) DropdownMenuEntry(value: y, label: s.fy(y)),
              ],
            ),
          const SizedBox(height: Tokens.sp2),
          if (rows.isEmpty) EmptyLine(s.nothingYet),
          for (final r in rows)
            Card(
              child: ListTile(
                key: Key('payslip-${r['id']}'),
                leading: const Icon(Icons.receipt_long_outlined),
                title: Text(s.month(DateTime.parse('${r['month']}-01'))),
                subtitle: Text('${s.net}: ${s.money(r['netPay'])}'),
                trailing: const Icon(Icons.visibility_outlined),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => FileScreen(
                      title: s.month(DateTime.parse('${r['month']}-01')),
                      passwordHint: m['passwordHint'] as String?,
                      load: () =>
                          ref.read(apiProvider).payrollPayslipMinePdf(recordId: '${r['id']}'),
                    ),
                  ),
                ),
              ),
            ),
        ];
      },
    );
  }
}
