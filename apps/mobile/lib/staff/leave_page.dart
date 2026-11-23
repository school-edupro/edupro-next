import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart';
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/file_screen.dart';
import '../ui/widgets.dart';
import 'data.dart';
import 'my_attendance.dart' show CorrectionForm, dayTone;
import 'my_leave.dart' show StaffLeaveForm, staffLeaveTone;

/// The four tabs, as the admin's Employee Leave / Attendance (docs/design/99).
const leaveTabs = ['attendance', 'leave', 'team-leave', 'team-attendance'];

/// How many report to me and how much waits with me (the tabs' counts).
final leaveMenuProvider = FutureProvider.autoDispose.family<Json, Profile>((ref, p) async {
  try {
    return asJson(await ref.watch(apiProvider).staffLeaveMenu());
  } on ApiException {
    return const {};
  }
});

/// My leave touching From–To, a page of 25.
final myLeaveListProvider = FutureProvider.autoDispose.family<Json, (Profile, String, String, int)>(
  (ref, a) async {
    final (_, from, to, page) = a;
    return asJson(
      await ref
          .watch(apiProvider)
          .staffLeaveMine(
            page: page,
            size: 25,
            from: from.isEmpty ? null : from,
            to: to.isEmpty ? null : to,
          ),
    );
  },
);

/// The filters of a reporties' list, as one key: status, employee, type, from, to, page.
typedef TeamFilter = (String, String, String, String, String, int);

final teamLeaveProvider = FutureProvider.autoDispose.family<Json, (Profile, TeamFilter)>((
  ref,
  a,
) async {
  final (status, employeeId, leaveTypeId, from, to, page) = a.$2;
  return asJson(
    await ref
        .watch(apiProvider)
        .leaveSelfTeam(
          status: status == 'all' ? null : status,
          employeeId: employeeId.isEmpty ? null : employeeId,
          leaveTypeId: leaveTypeId.isEmpty ? null : leaveTypeId,
          from: from.isEmpty ? null : from,
          to: to.isEmpty ? null : to,
          page: page,
          size: 25,
        ),
  );
});

final teamAttendanceProvider = FutureProvider.autoDispose
    .family<Json, (Profile, String, String, String, int)>((ref, a) async {
      final (_, employeeId, from, to, page) = a;
      return asJson(
        await ref
            .watch(apiProvider)
            .staffAttendanceTeam(
              employeeId: employeeId.isEmpty ? null : employeeId,
              from: from,
              to: to,
              page: page,
              size: 50,
            ),
      );
    });

/// An Excel or PDF the API answers in base64, as the file viewer takes it.
Future<ApiFile> leaveFile(Future<dynamic> call, String name) async {
  final r = asJson(await call);
  return ApiFile(
    bytes: base64Decode('${r['base64'] ?? ''}'),
    contentType: '${r['contentType'] ?? 'application/octet-stream'}',
    name: '${r['filename'] ?? name}',
  );
}

void _openFile(BuildContext context, String title, Future<dynamic> Function() call) =>
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => FileScreen(title: title, load: () => leaveFile(call(), title)),
      ),
    );

/// the leave year a day is in: 1 April to 31 March
(String, String) leaveYearOf(DateTime d) {
  final y = d.month < 4 ? d.year - 1 : d.year;
  return ('$y-04-01', '${y + 1}-03-31');
}

String _n(Object? v) {
  final x = num.tryParse('$v');
  return x == null ? '$v' : x.toStringAsFixed(2);
}

/// Who a correction waits for, or who decided it (as the websites say it).
String? correctionWords(S s, Json g) {
  final status = '${g['status']}';
  final by = g['decided_by'];
  final when = g['decided_at'] == null ? '' : s.dateTime(DateTime.parse('${g['decided_at']}'));
  if (status == 'pending') {
    return g['waiting'] == null ? s.lvWaitingApprover : s.lvWaitingFor('${g['waiting']}');
  }
  if (status == 'approved' && by != null) return s.lvApprovedBy('$by', when);
  if (status == 'rejected' && by != null) {
    return s.lvRejectedBy('$by', when, g['decided_note'] == null ? null : '${g['decided_note']}');
  }
  return null;
}

/// Leave & attendance on the phone as the admin's Employee Leave / Attendance page (docs/design/99): the balance
/// with Leave details, the downloads and Apply leave over four tabs — My Attendance (Regularise from a day's row),
/// My Leave, Reporties Leave (Approve / Reject in the list) and Reporties Attendance.
class LeaveAttendanceScreen extends ConsumerStatefulWidget {
  const LeaveAttendanceScreen({super.key, required this.profile, this.initialTab = 'leave'});
  final Profile profile;

  /// attendance · leave · team-leave · team-attendance
  final String initialTab;

  @override
  ConsumerState<LeaveAttendanceScreen> createState() => _LeaveAttendanceScreenState();
}

class _LeaveAttendanceScreenState extends ConsumerState<LeaveAttendanceScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs = TabController(
    length: leaveTabs.length,
    vsync: this,
    initialIndex: leaveTabs.contains(widget.initialTab) ? leaveTabs.indexOf(widget.initialTab) : 1,
  );

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final leave = ref.watch(myLeaveProvider(widget.profile));
    final menu = ref.watch(leaveMenuProvider(widget.profile)).value ?? const {};
    final waiting = (menu['leave'] as num?)?.toInt() ?? 0;
    final team = (menu['team'] as num?)?.toInt() ?? 0;
    final bar = TabBar(
      key: const Key('lvTabs'),
      controller: _tabs,
      isScrollable: true,
      tabAlignment: TabAlignment.start,
      tabs: [
        Tab(text: s.lvTabAttendance),
        Tab(text: s.lvTabLeave),
        Tab(text: s.lvTabTeamLeave(waiting)),
        Tab(text: s.lvTabTeamAttendance(team)),
      ],
    );
    return NestedScrollView(
      key: const Key('lvScreen'),
      headerSliverBuilder: (context, _) => [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(Tokens.sp4, Tokens.sp4, Tokens.sp4, Tokens.sp2),
            child: leave.hasValue
                ? _Balance(profile: widget.profile, d: leave.value!.data)
                : leave.hasError
                ? ErrorText(errorText(s, leave.error!))
                : const LinearProgressIndicator(),
          ),
        ),
        SliverPersistentHeader(
          pinned: true,
          delegate: _TabsHeader(bar, Theme.of(context).colorScheme.surface),
        ),
      ],
      body: TabBarView(
        controller: _tabs,
        children: [
          _MyAttendanceTab(profile: widget.profile),
          _MyLeaveTab(profile: widget.profile),
          _TeamLeaveTab(profile: widget.profile, team: team),
          _TeamAttendanceTab(profile: widget.profile, team: team),
        ],
      ),
    );
  }
}

class _TabsHeader extends SliverPersistentHeaderDelegate {
  _TabsHeader(this.bar, this.color);
  final TabBar bar;
  final Color color;

  @override
  double get minExtent => bar.preferredSize.height;
  @override
  double get maxExtent => bar.preferredSize.height;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) =>
      Material(color: color, child: bar);

  @override
  bool shouldRebuild(_TabsHeader old) => old.bar != bar || old.color != color;
}

/// Who I am, Leave details, Download leave, Download attendance, Apply leave, then a card a leave type.
class _Balance extends ConsumerWidget {
  const _Balance({required this.profile, required this.d});
  final Profile profile;
  final Json d;

  static const _edges = [
    Tokens.mobNavy800,
    Tokens.statusWarning,
    Tokens.statusDanger,
    Tokens.statusInfo,
    Tokens.statusSuccess,
  ];

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final emp = d['employee'] is Map ? asJson(d['employee']) : null;
    final types = asList(d['types']);
    final balances = {for (final b in asList(d['balances'])) '${b['typeId']}': b};
    final month = ym(schoolToday());
    if (emp == null) return Text(s.lvNoEmployee, key: const Key('lvNoEmployee'));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          '${emp['name']} (${emp['code']})${emp['department'] == null ? '' : ' · ${emp['department']}'}',
          key: const Key('lvWho'),
          style: const TextStyle(fontWeight: Tokens.fwSemibold),
        ),
        const SizedBox(height: Tokens.sp2),
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          children: [
            OutlinedButton(
              key: const Key('lvDetails'),
              onPressed: () => _details(context, s, types, balances),
              child: Text(s.lvDetails),
            ),
            OutlinedButton(
              key: const Key('lvDownloadLeave'),
              onPressed: () => _openFile(
                context,
                s.lvDownloadLeave,
                () => ref.read(apiProvider).leaveSelfLeaveFile(format: 'xlsx'),
              ),
              child: Text(s.lvDownloadLeave),
            ),
            OutlinedButton(
              key: const Key('lvDownloadAttendance'),
              onPressed: () => _openFile(
                context,
                s.lvDownloadAttendance,
                () => ref.read(apiProvider).leaveSelfAttendanceFile(month: month, format: 'xlsx'),
              ),
              child: Text(s.lvDownloadAttendance),
            ),
            if (asJson(d['can'])['apply'] != false)
              FilledButton.icon(
                key: const Key('applyStaffLeave'),
                style: FilledButton.styleFrom(minimumSize: const Size(48, 44)),
                icon: const Icon(Icons.add),
                label: Text(s.applyLeave),
                onPressed: () => _apply(context, ref, s, types),
              ),
          ],
        ),
        const SizedBox(height: Tokens.sp3),
        LayoutBuilder(
          builder: (context, box) {
            final w = box.maxWidth >= 560
                ? (box.maxWidth - Tokens.sp2 * 2) / 3
                : (box.maxWidth - Tokens.sp2) / 2;
            return Wrap(
              key: const Key('lvCards'),
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp2,
              children: [
                for (var i = 0; i < types.length; i++)
                  SizedBox(
                    width: w,
                    child: _card(
                      context,
                      s,
                      muted,
                      types[i],
                      balances['${types[i]['id']}'],
                      _edges[i % _edges.length],
                    ),
                  ),
              ],
            );
          },
        ),
      ],
    );
  }

  Widget _card(BuildContext context, S s, Color muted, Json t, Json? b, Color edge) => Card(
    key: Key('lvCard-${t['code']}'),
    margin: EdgeInsets.zero,
    child: IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Container(width: 4, color: edge),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(Tokens.sp2),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${t['name']}', style: const TextStyle(fontSize: 13)),
                  Text(
                    '${t['code']}',
                    style: Theme.of(context).textTheme.titleMedium
                        ?.copyWith(fontWeight: Tokens.fwSemibold),
                  ),
                  if (b != null) ...[
                    Text(
                      s.lvAvailable(_n(b['available'])),
                      style: const TextStyle(fontWeight: Tokens.fwSemibold),
                    ),
                    Text(
                      s.lvAvailed(_n(b['availed'] ?? 0)),
                      style: TextStyle(color: muted, fontSize: 13),
                    ),
                  ] else ...[
                    Text(s.lvNoBalance, style: TextStyle(color: muted, fontSize: 13)),
                    Text(
                      t['maxDays'] == null ? s.lvNoLimit : s.lvMaxPer('${t['maxDays']}'),
                      style: TextStyle(color: muted, fontSize: 13),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    ),
  );

  void _details(
    BuildContext context,
    S s,
    List<Json> types,
    Map<String, Json> balances,
  ) => showDialog<void>(
    context: context,
    builder: (c) => AlertDialog(
      title: Text(s.lvDetails),
      content: SizedBox(
        width: double.maxFinite,
        child: ListView(
          shrinkWrap: true,
          children: [
            for (final t in types)
              () {
                final b = balances['${t['id']}'];
                return Padding(
                  key: Key('lvDetail-${t['code']}'),
                  padding: const EdgeInsets.only(bottom: Tokens.sp3),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${t['name']} (${t['code']})${t['halfDay'] == true ? ' · ${s.lvHalfDays}' : ''}',
                        style: const TextStyle(fontWeight: Tokens.fwSemibold),
                      ),
                      Text(
                        [
                          '${s.lvPolicy}: ${b?['policy'] ?? (t['keepsBalance'] == false ? s.lvNoKept : '—')}',
                          if (b != null) ...[
                            s.lvAvailable(_n(b['available'])),
                            '${s.lvHeld}: ${_n(b['held'] ?? 0)}',
                            '${s.lvAvailedYear}: ${_n(b['availed'] ?? 0)}',
                          ],
                          '${s.lvMostAtATime}: ${t['maxDays'] == null ? '—' : s.lvDays('${t['maxDays']}')}',
                        ].join(' · '),
                      ),
                    ],
                  ),
                );
              }(),
            Text(s.lvDetailsHelp, style: const TextStyle(fontSize: 13)),
          ],
        ),
      ),
      actions: [TextButton(onPressed: () => Navigator.pop(c), child: Text(s.close))],
    ),
  );

  Future<void> _apply(BuildContext context, WidgetRef ref, S s, List<Json> types) async {
    final sent = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => FamilyPage(
          title: s.applyLeave,
          child: StaffLeaveForm(types: types),
        ),
      ),
    );
    if (sent == true && context.mounted) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(s.leaveSent)));
      ref.invalidate(myLeaveProvider(profile));
      ref.invalidate(myLeaveListProvider);
    }
  }
}

/// A date chip that opens a date picker (From / To on the lists).
class _DateButton extends ConsumerWidget {
  const _DateButton({
    required this.keyName,
    required this.label,
    required this.value,
    required this.on,
  });
  final String keyName;
  final String label;
  final String value;
  final ValueChanged<String> on;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return OutlinedButton.icon(
      key: Key(keyName),
      icon: const Icon(Icons.calendar_today_outlined),
      label: Text('$label: ${value.isEmpty ? '—' : s.date(value)}'),
      onPressed: () async {
        final d = await showDatePicker(
          context: context,
          initialDate: DateTime.tryParse(value) ?? schoolToday(),
          firstDate: DateTime(2020),
          lastDate: DateTime(2035),
        );
        if (d != null) on(ymd(d));
      },
    );
  }
}

/// Showing a – b of n, the Excel and PDF of everything, Previous / Next.
class _ListBar extends ConsumerWidget {
  const _ListBar({
    required this.page,
    required this.size,
    required this.total,
    required this.onPage,
    this.file,
  });
  final int page;
  final int size;
  final int total;
  final ValueChanged<int> onPage;

  /// the list's file (Excel or PDF) as the API answers it
  final Future<dynamic> Function(String format)? file;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final a = total == 0 ? 0 : (page - 1) * size + 1;
    final b = (page * size).clamp(0, total);
    return Wrap(
      spacing: Tokens.sp2,
      runSpacing: Tokens.sp2,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text(s.lvShowing(a, b, total), style: const TextStyle(fontWeight: Tokens.fwSemibold)),
        if (file != null && total > 0) ...[
          OutlinedButton(
            onPressed: () => _openFile(context, s.lvExcel, () => file!('xlsx')),
            child: Text(s.lvExcel),
          ),
          OutlinedButton(
            onPressed: () => _openFile(context, s.lvPdf, () => file!('pdf')),
            child: Text(s.lvPdf),
          ),
        ],
        if (page > 1) TextButton(onPressed: () => onPage(page - 1), child: Text(s.previous)),
        if (page * size < total) TextButton(onPressed: () => onPage(page + 1), child: Text(s.next)),
      ],
    );
  }
}

/// My Attendance: a month's every day (the code and words, late, early, in and out), Regularise on a day that may
/// still be corrected, and the corrections asked.
class _MyAttendanceTab extends ConsumerStatefulWidget {
  const _MyAttendanceTab({required this.profile});
  final Profile profile;

  @override
  ConsumerState<_MyAttendanceTab> createState() => _MyAttendanceTabState();
}

class _MyAttendanceTabState extends ConsumerState<_MyAttendanceTab> {
  DateTime _month = DateTime(schoolToday().year, schoolToday().month);

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final arg = (widget.profile, ym(_month));
    final today = ymd(schoolToday());
    return LoadedList<Json>(
      key: const PageStorageKey('lvAttendance'),
      value: ref.watch(myStaffAttendanceProvider(arg)),
      refresh: () => ref.refresh(myStaffAttendanceProvider(arg).future),
      children: (m) {
        final by = {for (final d in asList(m['days'])) '${d['day']}': d};
        final regs = asList(m['regularisations']);
        final regOf = <String, Json>{};
        for (final g in regs) {
          regOf.putIfAbsent('${g['day']}', () => g);
        }
        final locked = m['locked'] == true;
        final from = m['correctionFrom'] == null ? null : '${m['correctionFrom']}';
        final emp = m['employee'] is Map ? asJson(m['employee']) : null;
        final last = DateTime(_month.year, _month.month + 1, 0).day;
        return [
          Row(
            children: [
              IconButton(
                key: const Key('lvPrevMonth'),
                tooltip: s.previous,
                icon: const Icon(Icons.chevron_left),
                onPressed: () => setState(() => _month = DateTime(_month.year, _month.month - 1)),
              ),
              Expanded(
                child: Text(
                  s.month(_month),
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              IconButton(
                key: const Key('lvNextMonth'),
                tooltip: s.next,
                icon: const Icon(Icons.chevron_right),
                onPressed: ym(_month) == today.substring(0, 7)
                    ? null
                    : () => setState(() => _month = DateTime(_month.year, _month.month + 1)),
              ),
            ],
          ),
          if (emp == null)
            EmptyLine(s.lvNoEmployee)
          else ...[
            if (locked)
              Text(s.lvLocked(s.month(_month)), key: const Key('lvLockedNote'))
            else if (from != null && from.compareTo('${ym(_month)}-01') > 0)
              Text(s.lvCorrectionFrom(s.date(from)), style: TextStyle(color: muted)),
            for (var n = 1; n <= last; n++)
              () {
                final day = ymd(DateTime(_month.year, _month.month, n));
                final x = by[day];
                final g = regOf[day];
                final words = g == null ? null : correctionWords(s, g);
                final may =
                    day.compareTo(today) <= 0 &&
                    !locked &&
                    (from == null || day.compareTo(from) >= 0);
                return Card(
                  key: Key('lvDay-$day'),
                  child: Padding(
                    padding: const EdgeInsets.all(Tokens.sp3),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Wrap(
                          spacing: Tokens.sp2,
                          runSpacing: Tokens.sp1,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            Text(
                              '$n · ${s.dayShort(day)}',
                              style: const TextStyle(fontWeight: Tokens.fwSemibold),
                            ),
                            if (x != null)
                              StatusChip(
                                '${x['code'] ?? x['dayType']} ${x['words'] ?? ''}'.trim(),
                                dayTone('${x['dayType']}'),
                              ),
                          ],
                        ),
                        if (x != null && (x['in'] != null || x['out'] != null))
                          Text('${s.inTime} ${x['in'] ?? '—'} · ${s.outTime} ${x['out'] ?? '—'}'),
                        if (x != null)
                          Text(
                            [
                              if (((x['late'] as num?) ?? 0) > 0) s.lvLate('${x['late']}'),
                              if (((x['early'] as num?) ?? 0) > 0) s.lvEarly('${x['early']}'),
                              if (x['remark'] != null) '${x['remark']}',
                            ].join(' · '),
                            style: TextStyle(color: muted, fontSize: 13),
                          ),
                        if (words != null)
                          Text(s.lvCorrection(words), style: TextStyle(color: muted, fontSize: 13)),
                        if (may)
                          Align(
                            alignment: Alignment.centerRight,
                            child: OutlinedButton(
                              key: Key('lvRegularise-$day'),
                              onPressed: () => _regularise(day, from),
                              child: Text(s.lvRegularise),
                            ),
                          ),
                      ],
                    ),
                  ),
                );
              }(),
            SectionTitle(s.lvCorrectionsAsked),
            if (regs.isEmpty) EmptyLine(s.lvNoneMonth),
            for (final r in regs)
              Card(
                child: ListTile(
                  title: Text(s.dayShort('${r['day']}')),
                  subtitle: Text(
                    [
                      [
                        if (r['in_time'] != null) '${s.inTime} ${r['in_time']}',
                        if (r['out_time'] != null) '${s.outTime} ${r['out_time']}',
                        if (r['day_type'] != null) s.dayType('${r['day_type']}'),
                        '${r['reason'] ?? ''}',
                      ].join(' · '),
                      ?correctionWords(s, r),
                    ].join('\n'),
                  ),
                  trailing: r['status'] == 'pending'
                      ? TextButton(
                          onPressed: () => _withdraw('${r['id']}'),
                          child: Text(s.withdraw),
                        )
                      : StatusChip(
                          s.staffLeaveStatus('${r['status']}'),
                          staffLeaveTone('${r['status']}'),
                        ),
                ),
              ),
          ],
        ];
      },
    );
  }

  Future<void> _regularise(String day, String? from) async {
    final s = ref.read(stringsProvider);
    final sent = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => FamilyPage(
          title: '${s.lvRegularise} · ${s.dayShort(day)}',
          child: CorrectionForm(
            day: DateTime.parse(day),
            earliest: from == null ? null : DateTime.tryParse(from),
          ),
        ),
      ),
    );
    if (sent == true && mounted) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(s.correctionSent)));
      ref.invalidate(myStaffAttendanceProvider((widget.profile, ym(_month))));
    }
  }

  Future<void> _withdraw(String id) async {
    final s = ref.read(stringsProvider);
    try {
      await ref
          .read(apiProvider)
          .staffAttendanceWithdrawReg(
            id: id,
            body: const StaffLeaveWithdrawDto(reason: ''),
          );
      ref.invalidate(myStaffAttendanceProvider((widget.profile, ym(_month))));
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
      }
    }
  }
}

/// A leave as a card: its number and status, type, dates and days, half day, reason, applied, who acted.
class _LeaveCard extends ConsumerWidget {
  const _LeaveCard({required this.r, this.who, this.actions = const []});
  final Json r;

  /// the employee (Reporties Leave)
  final Json? who;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final type = asJson(r['leaveType']);
    final status = '${r['status']}';
    final from = '${r['from']}';
    final to = '${r['to']}';
    return Card(
      key: Key('lvLeave-${r['id']}'),
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp1,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text('${r['number'] ?? ''}', style: const TextStyle(fontWeight: Tokens.fwSemibold)),
                StatusChip(s.staffLeaveStatus(status), staffLeaveTone(status)),
              ],
            ),
            if (who != null)
              Text(
                '${who!['name']} (${who!['code']})${who!['department'] == null ? '' : ' · ${who!['department']}'}',
                style: const TextStyle(fontWeight: Tokens.fwSemibold),
              ),
            Text('${type['code'] ?? ''} — ${type['name'] ?? ''}'),
            Text(
              [
                from == to ? s.date(from) : '${s.date(from)} – ${s.date(to)}',
                if (r['days'] != null) s.lvDays('${r['days']}'),
                if (r['halfDay'] == true) s.lvHalf('${r['session']}'),
              ].join(' · '),
            ),
            if ('${r['reason'] ?? ''}'.isNotEmpty) Text('${r['reason']}'),
            if (r['what'] == 'cancellation' && r['cancelReason'] != null)
              Text(
                s.lvToCancel('${r['cancelReason']}'),
                style: TextStyle(color: muted, fontSize: 13),
              ),
            Text(
              [
                if (r['appliedAt'] != null)
                  s.lvApplied(s.dateTime(DateTime.parse('${r['appliedAt']}'))),
                if (r['source'] == 'on_behalf') s.lvOnBehalf,
                if (r['decidedBy'] != null)
                  s.lvActionBy(
                    '${r['decidedBy']}',
                    r['decidedAt'] == null ? '' : s.dateTime(DateTime.parse('${r['decidedAt']}')),
                  ),
                if (status == 'pending' && r['waitingWith'] != null) '${r['waitingWith']}',
              ].join(' · '),
              style: TextStyle(color: muted, fontSize: 13),
            ),
            if (actions.isNotEmpty) ...[
              const SizedBox(height: Tokens.sp2),
              Wrap(spacing: Tokens.sp2, runSpacing: Tokens.sp2, children: actions),
            ],
          ],
        ),
      ),
    );
  }
}

/// Asks for a reason in a window; `required`: 3 letters or more.
Future<String?> _reasonDialog(
  BuildContext context,
  S s, {
  required String title,
  String? body,
  required String label,
  required String confirm,
  bool required = true,
}) {
  final c = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (d) => StatefulBuilder(
      builder: (d, set) => AlertDialog(
        title: Text(title),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (body != null) Text(body),
            TextField(
              key: const Key('lvReason'),
              controller: c,
              maxLines: 2,
              maxLength: 500,
              decoration: InputDecoration(labelText: label),
              onChanged: (_) => set(() {}),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(d).pop(), child: Text(s.cancel)),
          FilledButton(
            key: const Key('lvReasonOk'),
            style: FilledButton.styleFrom(minimumSize: const Size(48, 44)),
            onPressed: required && c.text.trim().length < 3
                ? null
                : () => Navigator.of(d).pop(c.text.trim()),
            child: Text(confirm),
          ),
        ],
      ),
    ),
  );
}

/// My Leave: From and To (the leave year), my leave touching them a page at a time, Withdraw / Ask to cancel.
class _MyLeaveTab extends ConsumerStatefulWidget {
  const _MyLeaveTab({required this.profile});
  final Profile profile;

  @override
  ConsumerState<_MyLeaveTab> createState() => _MyLeaveTabState();
}

class _MyLeaveTabState extends ConsumerState<_MyLeaveTab> {
  late String _from = leaveYearOf(schoolToday()).$1;
  late String _to = leaveYearOf(schoolToday()).$2;
  int _page = 1;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final key = (widget.profile, _from, _to, _page);
    final async = ref.watch(myLeaveListProvider(key));
    return ListView(
      key: const PageStorageKey('lvLeave'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          children: [
            _DateButton(
              keyName: 'lvFrom',
              label: s.lvFrom,
              value: _from,
              on: (v) => setState(() {
                _from = v;
                _page = 1;
              }),
            ),
            _DateButton(
              keyName: 'lvTo',
              label: s.lvTo,
              value: _to,
              on: (v) => setState(() {
                _to = v;
                _page = 1;
              }),
            ),
          ],
        ),
        const SizedBox(height: Tokens.sp3),
        if (!async.hasValue)
          async.hasError ? ErrorText(errorText(s, async.error!)) : const LinearProgressIndicator()
        else ...[
          _ListBar(
            page: _page,
            size: 25,
            total: (async.value!['total'] as num?)?.toInt() ?? 0,
            onPage: (p) => setState(() => _page = p),
            file: (f) => ref.read(apiProvider).leaveSelfLeaveFile(from: _from, to: _to, format: f),
          ),
          if (asList(async.value!['rows']).isEmpty) EmptyLine(s.lvNoLeave),
          for (final r in asList(async.value!['rows']))
            _LeaveCard(
              r: r,
              actions: [
                if (asJson(r['can'])['withdraw'] == true)
                  OutlinedButton(
                    key: Key('lvWithdraw-${r['id']}'),
                    onPressed: () => _withdraw(r),
                    child: Text(s.withdraw),
                  ),
                if (asJson(r['can'])['requestCancel'] == true)
                  OutlinedButton(
                    key: Key('lvAskCancel-${r['id']}'),
                    onPressed: () => _askCancel(r),
                    child: Text(s.askCancel),
                  ),
              ],
            ),
        ],
      ],
    );
  }

  void _refresh() {
    ref.invalidate(myLeaveListProvider);
    ref.invalidate(myLeaveProvider(widget.profile));
  }

  Future<void> _withdraw(Json r) async {
    final s = ref.read(stringsProvider);
    final why = await _reasonDialog(
      context,
      s,
      title: '${s.withdraw} ${r['number'] ?? ''}',
      label: s.reason,
      confirm: s.withdraw,
      required: false,
    );
    if (why == null) return;
    try {
      await ref
          .read(apiProvider)
          .staffLeaveWithdraw(
            id: '${r['id']}',
            body: StaffLeaveWithdrawDto(reason: why),
          );
      _refresh();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
      }
    }
  }

  Future<void> _askCancel(Json r) async {
    final s = ref.read(stringsProvider);
    final why = await _reasonDialog(
      context,
      s,
      title: '${s.askCancel} ${r['number'] ?? ''}',
      label: s.reason,
      confirm: s.send,
    );
    if (why == null) return;
    try {
      await ref
          .read(apiProvider)
          .staffLeaveRequestCancel(
            id: '${r['id']}',
            body: StaffLeaveReasonDto(reason: why),
          );
      _refresh();
      if (mounted) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(s.lvSent)));
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
      }
    }
  }
}

/// A list to pick from, typed to find (the arrow names its list).
Widget _pick(
  String key,
  String label,
  String value,
  List<(String, String)> entries,
  ValueChanged<String> on,
) => DropdownMenu<String>(
  key: Key(key),
  label: Text(label),
  expandedInsets: EdgeInsets.zero,
  initialSelection: value,
  enableFilter: true,
  trailingIcon: dropArrow(label),
  selectedTrailingIcon: dropArrow(label, open: true),
  onSelected: (v) => on(v ?? ''),
  dropdownMenuEntries: [for (final (v, l) in entries) DropdownMenuEntry(value: v, label: l)],
);

/// Reporties Leave: Waiting with me first, or my reportees' leave by employee, type, status and dates; Approve, or
/// Reject with a reason, in the row (a cancellation too).
class _TeamLeaveTab extends ConsumerStatefulWidget {
  const _TeamLeaveTab({required this.profile, required this.team});
  final Profile profile;
  final int team;

  @override
  ConsumerState<_TeamLeaveTab> createState() => _TeamLeaveTabState();
}

class _TeamLeaveTabState extends ConsumerState<_TeamLeaveTab> {
  String _status = 'waiting';
  String _employee = '';
  String _type = '';
  late String _from = leaveYearOf(schoolToday()).$1;
  late String _to = leaveYearOf(schoolToday()).$2;
  int _page = 1;
  bool _busy = false;

  TeamFilter get _f => (_status, _employee, _type, _from, _to, _page);

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final async = ref.watch(teamLeaveProvider((widget.profile, _f)));
    final t = async.value;
    final filters = asJson(t?['filters']);
    return ListView(
      key: const PageStorageKey('lvTeamLeave'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        _pick(
          'lvStatus',
          s.lvStatus,
          _status,
          [
            ('waiting', s.lvWaitingWithMe),
            ('all', s.lvAll),
            for (final x in ['pending', 'approved', 'rejected', 'withdrawn', 'cancelled'])
              (x, x == 'pending' ? s.lvWaitingAny : s.staffLeaveStatus(x)),
          ],
          (v) => setState(() {
            _status = v.isEmpty ? 'waiting' : v;
            _page = 1;
          }),
        ),
        const SizedBox(height: Tokens.sp2),
        _pick(
          'lvEmployee',
          s.lvEmployee,
          _employee,
          [
            ('', s.lvAllEmployees),
            for (final e in asList(filters['employees']))
              ('${e['id']}', '${e['name']} (${e['code']})'),
          ],
          (v) => setState(() {
            _employee = v;
            _page = 1;
          }),
        ),
        const SizedBox(height: Tokens.sp2),
        _pick(
          'lvType',
          s.lvType,
          _type,
          [
            ('', s.lvAllTypes),
            for (final x in asList(filters['types'])) ('${x['id']}', '${x['code']} — ${x['name']}'),
          ],
          (v) => setState(() {
            _type = v;
            _page = 1;
          }),
        ),
        const SizedBox(height: Tokens.sp2),
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          children: [
            _DateButton(
              keyName: 'lvTeamFrom',
              label: s.lvFrom,
              value: _from,
              on: (v) => setState(() {
                _from = v;
                _page = 1;
              }),
            ),
            _DateButton(
              keyName: 'lvTeamTo',
              label: s.lvTo,
              value: _to,
              on: (v) => setState(() {
                _to = v;
                _page = 1;
              }),
            ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: Tokens.sp2),
          child: Text(s.lvWaitingHelp, style: TextStyle(color: muted, fontSize: 13)),
        ),
        if (t == null)
          async.hasError ? ErrorText(errorText(s, async.error!)) : const LinearProgressIndicator()
        else ...[
          _ListBar(
            page: _page,
            size: 25,
            total: (t['total'] as num?)?.toInt() ?? 0,
            onPage: (p) => setState(() => _page = p),
            file: (f) => ref
                .read(apiProvider)
                .leaveSelfTeam(
                  status: _status == 'all' ? null : _status,
                  employeeId: _employee.isEmpty ? null : _employee,
                  leaveTypeId: _type.isEmpty ? null : _type,
                  from: _from,
                  to: _to,
                  format: f,
                ),
          ),
          if (widget.team == 0 && asList(t['rows']).isEmpty) EmptyLine(s.lvNobody),
          if (widget.team > 0 && asList(t['rows']).isEmpty)
            EmptyLine(_status == 'waiting' ? s.lvNoneWaiting : s.lvNoLeaves),
          for (final r in asList(t['rows']))
            () {
              final can = asJson(r['can']);
              final cancellation = can['decide'] != true && can['decideCancel'] == true;
              return _LeaveCard(
                r: r,
                who: asJson(r['employee']),
                actions: [
                  if (can['decide'] == true || can['decideCancel'] == true) ...[
                    FilledButton(
                      key: Key('lvApprove-${r['id']}'),
                      style: FilledButton.styleFrom(minimumSize: const Size(48, 44)),
                      onPressed: _busy ? null : () => _decide(r, 'approved', cancellation),
                      child: Text(cancellation ? s.lvApproveCancel : s.lvApprove),
                    ),
                    OutlinedButton(
                      key: Key('lvReject-${r['id']}'),
                      onPressed: _busy ? null : () => _reject(r, cancellation),
                      child: Text(cancellation ? s.lvRejectCancel : s.lvReject),
                    ),
                  ],
                ],
              );
            }(),
        ],
      ],
    );
  }

  Future<void> _reject(Json r, bool cancellation) async {
    final s = ref.read(stringsProvider);
    final name = '${asJson(r['employee'])['name'] ?? ''}';
    final why = await _reasonDialog(
      context,
      s,
      title: s.lvRejectTitle('${r['number'] ?? ''}'),
      body: s.lvRejectBody(name, cancellation),
      label: s.lvWhy,
      confirm: s.lvDoNotApprove,
    );
    if (why == null) return;
    await _decide(r, 'rejected', cancellation, note: why);
  }

  Future<void> _decide(Json r, String outcome, bool cancellation, {String? note}) async {
    final s = ref.read(stringsProvider);
    setState(() => _busy = true);
    try {
      final body = StaffLeaveDecideDto(outcome: outcome, note: note);
      final api = ref.read(apiProvider);
      if (cancellation) {
        await api.staffLeaveDecideCancel(id: '${r['id']}', body: body);
      } else {
        await api.staffLeaveDecide(id: '${r['id']}', body: body);
      }
      ref.invalidate(teamLeaveProvider);
      ref.invalidate(leaveMenuProvider(widget.profile));
      if (mounted) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(
            SnackBar(content: Text(outcome == 'approved' ? s.lvApproved : s.lvRejected)),
          );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

/// Reporties Attendance: all of them a column a day (up to 31 days), or one person's days one by one (up to 92).
class _TeamAttendanceTab extends ConsumerStatefulWidget {
  const _TeamAttendanceTab({required this.profile, required this.team});
  final Profile profile;
  final int team;

  @override
  ConsumerState<_TeamAttendanceTab> createState() => _TeamAttendanceTabState();
}

class _TeamAttendanceTabState extends ConsumerState<_TeamAttendanceTab> {
  String _employee = '';
  late String _from = '${ym(schoolToday())}-01';
  late String _to = ymd(schoolToday());
  int _page = 1;

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final muted = Theme.of(context).colorScheme.onSurfaceVariant;
    final line = Theme.of(context).colorScheme.outlineVariant;
    if (widget.team == 0) {
      return ListView(
        key: const PageStorageKey('lvTeamAttendance'),
        padding: const EdgeInsets.all(Tokens.sp4),
        children: [EmptyLine(s.lvNobody)],
      );
    }
    final async = ref.watch(teamAttendanceProvider((widget.profile, _employee, _from, _to, _page)));
    final a = async.value;
    return ListView(
      key: const PageStorageKey('lvTeamAttendance'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        _pick(
          'lvTeamEmployee',
          s.lvEmployee,
          _employee,
          [
            ('', s.lvAllEmployees),
            for (final e in asList(a?['employees'])) ('${e['id']}', '${e['name']} (${e['code']})'),
          ],
          (v) => setState(() {
            _employee = v;
            _page = 1;
          }),
        ),
        const SizedBox(height: Tokens.sp2),
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          children: [
            _DateButton(
              keyName: 'lvAttFrom',
              label: s.lvFrom,
              value: _from,
              on: (v) => setState(() {
                _from = v;
                _page = 1;
              }),
            ),
            _DateButton(
              keyName: 'lvAttTo',
              label: s.lvTo,
              value: _to,
              on: (v) => setState(() {
                _to = v;
                _page = 1;
              }),
            ),
          ],
        ),
        Padding(
          padding: const EdgeInsets.symmetric(vertical: Tokens.sp2),
          child: Text(s.lvTeamHelp, style: TextStyle(color: muted, fontSize: 13)),
        ),
        if (a == null)
          async.hasError ? ErrorText(errorText(s, async.error!)) : const LinearProgressIndicator()
        else ...[
          _ListBar(
            page: _page,
            size: (a['size'] as num?)?.toInt() ?? 50,
            total: (a['total'] as num?)?.toInt() ?? 0,
            onPage: (p) => setState(() => _page = p),
            file: (f) => ref
                .read(apiProvider)
                .staffAttendanceTeam(
                  employeeId: _employee.isEmpty ? null : _employee,
                  from: _from,
                  to: _to,
                  format: f,
                ),
          ),
          const SizedBox(height: Tokens.sp2),
          if (a['mode'] == 'days')
            for (final d in asList(a['days']))
              Card(
                key: Key('lvTeamDay-${d['day']}'),
                child: ListTile(
                  title: Text(s.dayShort('${d['day']}')),
                  subtitle: Text(
                    [
                      if (d['in'] != null || d['out'] != null)
                        '${s.inTime} ${d['in'] ?? '—'} · ${s.outTime} ${d['out'] ?? '—'}',
                      if ('${d['lateEarly'] ?? ''}'.isNotEmpty) '${d['lateEarly']}',
                      if (d['remark'] != null) '${d['remark']}',
                    ].join(' · '),
                  ),
                  trailing: StatusChip(
                    '${d['code']}${d['words'] == null ? '' : ' ${d['words']}'}',
                    dayTone('${d['dayType'] ?? d['code']}'),
                  ),
                ),
              )
          else
            _Grid(a: a, line: line),
        ],
      ],
    );
  }
}

/// All my reportees, a column a day: each day's code, and the totals; it slides sideways.
class _Grid extends ConsumerWidget {
  const _Grid({required this.a, required this.line});
  final Json a;
  final Color line;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dates = [for (final x in (a['dates'] as List?) ?? const []) '$x'];
    final types = [for (final x in (a['types'] as List?) ?? const []) '$x'];
    final totals = ['P', 'HD', 'A', 'WO', 'H', ...types];
    Widget cell(String t, {double w = 40, bool head = false, bool start = false}) => Container(
      width: w,
      padding: const EdgeInsets.symmetric(horizontal: Tokens.sp1, vertical: Tokens.sp2),
      decoration: BoxDecoration(
        border: Border(
          right: BorderSide(color: line),
          bottom: BorderSide(color: line),
        ),
      ),
      alignment: start ? Alignment.centerLeft : Alignment.center,
      child: Text(t, style: TextStyle(fontSize: 12, fontWeight: head ? Tokens.fwSemibold : null)),
    );
    return Semantics(
      label: s.lvTabTeamAttendance(0),
      container: true,
      explicitChildNodes: true,
      child: SingleChildScrollView(
        key: const Key('lvGrid'),
        scrollDirection: Axis.horizontal,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  cell(s.lvEmployeeCol, w: 150, head: true, start: true),
                  for (final d in dates) cell(d.substring(8, 10), head: true),
                  for (final t in totals) cell(t, w: 44, head: true),
                ],
              ),
            ),
            for (final r in asList(a['rows']))
              IntrinsicHeight(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    cell(
                      '${asJson(r['employee'])['name']}\n${asJson(r['employee'])['code']}',
                      w: 150,
                      start: true,
                    ),
                    for (final d in dates)
                      cell(
                        '${asList(r['cells']).where((c) => c['day'] == d).firstOrNull?['code'] ?? ''}',
                      ),
                    for (final t in totals) cell('${asJson(r['totals'])[t] ?? 0}', w: 44),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
