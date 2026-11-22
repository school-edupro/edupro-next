import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'data.dart';

/// The date sheets of the classes the person may read marks of (the working year); none when not part of the role.
final staffDateSheetsProvider = FutureProvider.autoDispose.family<List<Json>, Profile>((
  ref,
  p,
) async {
  try {
    final r = asJson(await ref.read(apiProvider).examDateSheetsStaff());
    return [for (final x in asList(r['data'])) x];
  } on ApiException catch (e) {
    if (e.status == 403) return const [];
    rethrow;
  }
});

/// Exam date sheet as on the staff website (docs/design/96, part 16): the exam (the coming one first), then a row a
/// date (the day under it) and a column a class with each paper and its time; the sheet's note. Wider than a phone:
/// it slides sideways. No web page.
class StaffDateSheetScreen extends ConsumerStatefulWidget {
  const StaffDateSheetScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<StaffDateSheetScreen> createState() => _StaffDateSheetScreenState();
}

class _StaffDateSheetScreenState extends ConsumerState<StaffDateSheetScreen> {
  String? _exam;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final async = ref.watch(staffDateSheetsProvider(widget.profile));
    Widget page(List<Widget> children) => RefreshIndicator(
      onRefresh: () => ref.refresh(staffDateSheetsProvider(widget.profile).future),
      child: ListView(
        key: const Key('dsScreen'),
        padding: const EdgeInsets.all(Tokens.sp4),
        children: children,
      ),
    );
    return async.when(
      loading: () => Center(
        child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
      ),
      error: (e, _) => page([ErrorText(errorText(s, e))]),
      data: (sheets) {
        if (sheets.isEmpty) {
          return page([
            Text(s.dsIntro, style: TextStyle(color: muted)),
            const SizedBox(height: Tokens.sp3),
            Text(s.dsNone, key: const Key('dsNone')),
          ]);
        }
        final today = ymd(schoolToday());
        bool coming(Json x) =>
            asList(x['classes'])
                .any((k) => asList(k['papers']).any((p) => '${p['examOn']}'.compareTo(today) >= 0));
        final chosen =
            sheets.where((x) => '${x['id']}' == _exam).firstOrNull ??
            sheets.where(coming).firstOrNull ??
            sheets.first;
        return page([
          Text(s.dsIntro, style: TextStyle(color: muted)),
          const SizedBox(height: Tokens.sp3),
          DropdownMenu<String>(
            key: const Key('dsExam'),
            label: Text(s.mkExam),
            expandedInsets: EdgeInsets.zero,
            initialSelection: '${chosen['id']}',
            trailingIcon: Icon(Icons.arrow_drop_down, semanticLabel: s.mkExam),
            selectedTrailingIcon: Icon(Icons.arrow_drop_up, semanticLabel: s.mkExam),
            onSelected: (v) => setState(() => _exam = v),
            dropdownMenuEntries: [
              for (final x in sheets) DropdownMenuEntry(value: '${x['id']}', label: '${x['name']}'),
            ],
          ),
          const SizedBox(height: Tokens.sp3),
          _DateGrid(key: ValueKey('dsGrid-${chosen['id']}'), sheet: chosen),
          if ('${chosen['note'] ?? ''}'.trim().isNotEmpty) ...[
            const SizedBox(height: Tokens.sp3),
            Text(
              '${chosen['note']}',
              key: const Key('dsNote'),
              style: TextStyle(color: muted),
            ),
          ],
        ]);
      },
    );
  }
}

/// The website's table: a row a date, a column a class; each cell the papers of that day with their time.
class _DateGrid extends ConsumerWidget {
  const _DateGrid({super.key, required this.sheet});
  final Json sheet;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    final line = (dark ? Tokens.mobGray700 : Tokens.mobGray200);
    final classes = asList(sheet['classes']);
    final dates = {
      for (final k in classes)
        for (final p in asList(k['papers'])) '${p['examOn']}',
    }.toList()..sort();
    final today = ymd(schoolToday());
    String time(Json p) => p['startsAt'] == null
        ? ''
        : '${p['startsAt']}${p['endsAt'] == null ? '' : '–${p['endsAt']}'}';
    Widget cell(Widget child, {bool head = false, bool mark = false}) => Container(
      padding: const EdgeInsets.all(Tokens.sp2),
      color: mark
          ? (dark ? Tokens.mobNavy700 : Tokens.mobCyan50)
          : head
          ? (dark ? Tokens.mobGray700 : Tokens.mobGray50)
          : null,
      child: child,
    );
    return Card(
      key: const Key('dsSheet'),
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.all(Tokens.sp3),
            child: Semantics(
              header: true,
              child: Text(
                '${sheet['name']}',
                style: Theme.of(context).textTheme.titleMedium
                    ?.copyWith(fontWeight: Tokens.fwSemibold),
              ),
            ),
          ),
          Semantics(
            label: s.dsSheetLabel,
            container: true,
            explicitChildNodes: true,
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Table(
                defaultColumnWidth: const FixedColumnWidth(130),
                columnWidths: const {0: FixedColumnWidth(104)},
                defaultVerticalAlignment: TableCellVerticalAlignment.top,
                border: TableBorder(horizontalInside: BorderSide(color: line)),
                children: [
                  TableRow(
                    children: [
                      cell(
                        Text(s.dateWord, style: const TextStyle(fontWeight: Tokens.fwBold)),
                        head: true,
                      ),
                      for (final k in classes)
                        cell(
                          Text(
                            '${k['classCode']}',
                            style: const TextStyle(fontWeight: Tokens.fwBold),
                          ),
                          head: true,
                        ),
                    ],
                  ),
                  for (final d in dates)
                    TableRow(
                      key: ValueKey('dsRow-$d'),
                      children: [
                        cell(
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                s.date(d),
                                style: const TextStyle(fontWeight: Tokens.fwSemibold),
                              ),
                              Text(
                                s.dsDayLong(DateTime.parse(d).weekday),
                                style: TextStyle(color: muted, fontSize: 12),
                              ),
                            ],
                          ),
                          mark: d == today,
                        ),
                        for (final k in classes)
                          cell(
                            Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                for (final p in asList(
                                  k['papers'],
                                ).where((p) => '${p['examOn']}' == d)) ...[
                                  Text('${p['subject']}'),
                                  if (time(p).isNotEmpty)
                                    Text(time(p), style: TextStyle(color: muted, fontSize: 12)),
                                ],
                              ],
                            ),
                            mark: d == today,
                          ),
                      ],
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
