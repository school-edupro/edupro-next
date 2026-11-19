import 'dart:math' as math;

import 'package:file_picker/file_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../staff/data.dart' show PickedFile, contentTypeOf, uploadFile;
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'common.dart';
import 'data.dart';

Tone attendanceTone(String code) => switch (code) {
  'P' => Tone.success,
  'A' => Tone.danger,
  'L' || 'SR' || 'H' => Tone.warning,
  _ => Tone.info,
};

Tone leaveTone(String status) => switch (status) {
  'approved' => Tone.success,
  'rejected' => Tone.danger,
  'pending' => Tone.warning,
  _ => Tone.neutral,
};

Tone busTone(String code) => switch (code) {
  'P' => Tone.success,
  'A' => Tone.danger,
  'LV' => Tone.info,
  'GP' => Tone.warning,
  _ => Tone.neutral,
};

/// Present out of the school days, rounded; none when no day was counted.
int? pctOf(num present, num days) => days > 0 ? (present / days * 100).round() : null;

/// The percentage's tone, as on the website: 90 and above good, 75 and above a warning, below that bad.
Tone pctTone(int? pct) => pct == null
    ? Tone.neutral
    : pct >= 90
    ? Tone.success
    : pct >= 75
    ? Tone.warning
    : Tone.danger;

Color _toneColor(Tone t) => switch (t) {
  Tone.success => Tokens.statusSuccess,
  Tone.danger => Tokens.statusDanger,
  Tone.warning => Tokens.statusWarning,
  Tone.info => Tokens.statusInfo,
  Tone.neutral => Tokens.mobGray400,
};

int _n(Object? v) => (v as num? ?? 0).toInt();

/// The phone's own picker for a leave's certificate or letter (PDF or photo); a test puts its own in.
final leaveFilePickerProvider = Provider<Future<List<PickedFile>> Function()>(
  (ref) => () async {
    final picked = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png', 'webp'],
    );
    return [
      for (final f in picked)
        PickedFile(name: f.name, bytes: await f.readAsBytes(), contentType: contentTypeOf(f.name)),
    ];
  },
);

/// The child's attendance as the website shows it (apps/parent/app/(app)/attendance), on the phone's own
/// screens: **Month** (the figures, a ring, the calendar with its key, the days with the gate times, the school
/// bus), **Year** (the session month by month, as bars and a list) and **Leave** (apply with the certificate,
/// follow the approval, cancel or end it).
class AttendanceScreen extends ConsumerStatefulWidget {
  const AttendanceScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<AttendanceScreen> createState() => _AttendanceScreenState();
}

class _AttendanceScreenState extends ConsumerState<AttendanceScreen> {
  DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);
  String _view = 'month';

  Profile get _p => widget.profile;

  @override
  Widget build(BuildContext context) {
    final p = _p;
    return switch (_view) {
      // each tab opens at its top
      'year' => LoadedList<Json?>(
        key: const ValueKey('att-year'),
        value: ref.watch(attendanceYearProvider(p)),
        refresh: () => ref.refresh(attendanceYearProvider(p).future),
        children: (c) => [_tabs(), ..._year(c)],
      ),
      'leave' => LoadedList<Json>(
        key: const ValueKey('att-leave'),
        value: ref.watch(leavesProvider(p)),
        refresh: () => ref.refresh(leavesProvider(p).future),
        children: (l) => [_tabs(), ..._leave(l)],
      ),
      _ => LoadedList<Json?>(
        key: const ValueKey('att-month'),
        value: ref.watch(attendanceProvider((p, ym(_month)))),
        refresh: () {
          ref.invalidate(busRollProvider((p, ym(_month))));
          return ref.refresh(attendanceProvider((p, ym(_month))).future);
        },
        children: (c) => [_tabs(), ..._monthView(c)],
      ),
    };
  }

  Widget _tabs() {
    final s = ref.watch(stringsProvider);
    final label = {'month': s.monthTab, 'year': s.yearTab, 'leave': s.leaves};
    return Padding(
      padding: const EdgeInsets.only(bottom: Tokens.sp3),
      child: Semantics(
        label: s.attendance,
        container: true,
        explicitChildNodes: true,
        child: Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          children: [
            for (final v in label.keys)
              ChoiceChip(
                key: Key('attView-$v'),
                label: Text(label[v]!),
                selected: _view == v,
                showCheckmark: false,
                onSelected: (_) => setState(() => _view = v),
              ),
          ],
        ),
      ),
    );
  }

  /// School days, present, absent, on leave, late or part of the day, and the percentage.
  Widget _figures(
    S s, {
    required int days,
    required int present,
    required int absent,
    required int leave,
    required int late,
  }) {
    final pct = pctOf(present, days);
    return FigureGrid(
      key: const Key('attFigures'),
      tiles: [
        FigureTile(label: s.schoolDays, value: '$days', icon: Icons.event_outlined),
        FigureTile(
          label: s.attendanceCode('P'),
          value: '$present',
          icon: Icons.check_circle_outline,
          tone: Tokens.statusSuccess,
        ),
        FigureTile(
          label: s.attendanceCode('A'),
          value: '$absent',
          icon: Icons.cancel_outlined,
          tone: Tokens.statusDanger,
        ),
        FigureTile(
          label: s.attendanceCode('LV'),
          value: '$leave',
          icon: Icons.beach_access_outlined,
          tone: Tokens.statusInfo,
        ),
        FigureTile(
          label: s.lateOrPart,
          value: '$late',
          icon: Icons.schedule_outlined,
          tone: Tokens.statusWarning,
        ),
        FigureTile(
          key: const Key('attPct'),
          label: s.attendance,
          value: pct == null ? '–' : '$pct%',
          icon: Icons.percent,
          tone: pct == null ? null : _toneColor(pctTone(pct)),
        ),
      ],
    );
  }

  Widget _applyButton(S s) => Padding(
    padding: const EdgeInsets.only(top: Tokens.sp4),
    child: FilledButton.icon(
      key: const Key('applyLeave'),
      icon: const Icon(Icons.add),
      label: Text(s.applyLeave),
      onPressed: _apply,
    ),
  );

  // ---------------------------------------------------------------- Month

  List<Widget> _monthView(Json? child) {
    final s = ref.watch(stringsProvider);
    final p = _p;
    final now = DateTime.now();
    final days = asList(child?['days']);
    final sum = asJson(child?['summary']);
    final late = days.where((d) => const {'L', 'SR', 'H'}.contains('${d['code']}')).length;
    final bus = ref.watch(busRollProvider((p, ym(_month)))).value?.data;
    final busDays = asList(bus?['days']);
    final busSum = asJson(bus?['summary']);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    String clock(Object? iso) {
      final t = DateTime.tryParse('${iso ?? ''}')?.toLocal();
      return t == null
          ? ''
          : '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';
    }

    return [
      Row(
        children: [
          IconButton(
            key: const Key('monthBack'),
            tooltip: s.previous,
            icon: const Icon(Icons.chevron_left),
            onPressed: () => setState(() => _month = DateTime(_month.year, _month.month - 1)),
          ),
          Expanded(
            child: Text(
              s.month(_month),
              key: const Key('attMonth'),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
            ),
          ),
          IconButton(
            key: const Key('monthNext'),
            tooltip: s.next,
            icon: const Icon(Icons.chevron_right),
            onPressed: _month.year == now.year && _month.month == now.month
                ? null
                : () => setState(() => _month = DateTime(_month.year, _month.month + 1)),
          ),
        ],
      ),
      const SizedBox(height: Tokens.sp2),
      _figures(
        s,
        days: _n(sum['days']),
        present: _n(sum['present']),
        absent: _n(sum['absent']),
        leave: _n(sum['leave']),
        late: late,
      ),
      const SizedBox(height: Tokens.sp4),
      if (days.isEmpty)
        EmptyLine(s.noAttendanceMonth)
      else ...[
        Card(
          child: Padding(
            padding: const EdgeInsets.all(Tokens.sp4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Center(
                  child: _Ring(
                    present: _n(sum['present']),
                    absent: _n(sum['absent']),
                    leave: _n(sum['leave']),
                  ),
                ),
                const SizedBox(height: Tokens.sp4),
                _MonthGrid(month: _month, days: {for (final d in days) '${d['date']}': d}),
                const SizedBox(height: Tokens.sp3),
                const _Legend(),
              ],
            ),
          ),
        ),
        const SizedBox(height: Tokens.sp3),
        // folded, as on the website: the days, newest first, with the gate times
        Card(
          clipBehavior: Clip.antiAlias,
          child: ExpansionTile(
            key: const Key('dayByDay'),
            leading: const Icon(Icons.list_alt_outlined),
            title: Text(s.dayByDay, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
            shape: const Border(),
            collapsedShape: const Border(),
            children: [
              for (final d in days.reversed)
                ListTile(
                  key: Key('day-${d['date']}'),
                  title: Text(s.dayShort(d['date'] ?? '')),
                  subtitle: (d['inAt'] == null && d['outAt'] == null)
                      ? null
                      : Text(
                          [
                            if (d['inAt'] != null) s.gateIn(clock(d['inAt'])),
                            if (d['outAt'] != null) s.gateOut(clock(d['outAt'])),
                          ].join(' · '),
                          style: TextStyle(color: muted),
                        ),
                  trailing: StatusChip(
                    s.attendanceCode('${d['code']}'),
                    attendanceTone('${d['code']}'),
                  ),
                ),
            ],
          ),
        ),
      ],
      if (busDays.isNotEmpty) ...[
        SectionTitle(
          '${s.schoolBus} · ${s.busTrips(_n(busSum['onBus']), _n(busSum['trips']))}',
          key: const Key('schoolBus'),
        ),
        Card(
          child: Column(
            children: [
              for (final d in busDays.reversed)
                Padding(
                  key: Key('bus-${d['date']}'),
                  padding: const EdgeInsets.symmetric(horizontal: Tokens.sp4, vertical: Tokens.sp3),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        [
                          s.dayShort(d['date'] ?? ''),
                          if ('${d['route'] ?? ''}'.isNotEmpty) '${s.route} ${d['route']}',
                        ].join(' · '),
                        style: const TextStyle(fontWeight: Tokens.fwSemibold),
                      ),
                      const SizedBox(height: Tokens.sp1),
                      Wrap(
                        spacing: Tokens.sp2,
                        runSpacing: Tokens.sp1,
                        children: [
                          for (final (part, code) in [
                            (s.morning, d['pick']),
                            (s.afternoon, d['drop']),
                          ])
                            code == null
                                ? StatusChip('$part: —', Tone.neutral)
                                : StatusChip('$part: ${s.busCode('$code')}', busTone('$code')),
                        ],
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
      _applyButton(s),
    ];
  }

  // ---------------------------------------------------------------- Year

  List<Widget> _year(Json? child) {
    final s = ref.watch(stringsProvider);
    final months = asList(child?['months']);
    final total = asJson(child?['total']);
    return [
      _figures(
        s,
        days: _n(total['days']),
        present: _n(total['present']),
        absent: _n(total['absent']),
        leave: _n(total['leave']),
        late: _n(total['late']),
      ),
      const SizedBox(height: Tokens.sp4),
      if (_n(total['days']) == 0)
        EmptyLine(s.noAttendanceYear)
      else ...[
        Card(
          child: Padding(
            padding: const EdgeInsets.all(Tokens.sp4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _YearBars(months: months),
                const SizedBox(height: Tokens.sp3),
                const _Legend(),
              ],
            ),
          ),
        ),
        SectionTitle(s.monthByMonth),
        Card(
          child: Column(
            children: [
              for (final m in months)
                Builder(
                  builder: (context) {
                    final at = DateTime.tryParse('${m['month']}-01') ?? DateTime.now();
                    final pct = pctOf(_n(m['present']), _n(m['days']));
                    return ListTile(
                      key: Key('month-${m['month']}'),
                      title: Text(
                        s.month(at),
                        style: const TextStyle(fontWeight: Tokens.fwSemibold),
                      ),
                      subtitle: Text(
                        s.monthLine(
                          _n(m['days']),
                          _n(m['present']),
                          _n(m['absent']),
                          _n(m['leave']),
                          _n(m['late']),
                        ),
                      ),
                      trailing: pct == null ? null : StatusChip('$pct%', pctTone(pct)),
                      // the month in full, as the website's month links do
                      onTap: () => setState(() {
                        _month = DateTime(at.year, at.month);
                        _view = 'month';
                      }),
                    );
                  },
                ),
            ],
          ),
        ),
      ],
      _applyButton(s),
    ];
  }

  // ---------------------------------------------------------------- Leave

  List<Widget> _leave(Json rules) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    final leaves = asList(rules['leaves']);
    return [
      FilledButton.icon(
        key: const Key('applyLeave'),
        icon: const Icon(Icons.add),
        label: Text(s.applyLeave),
        onPressed: () => _open(rules),
      ),
      const SizedBox(height: Tokens.sp2),
      Text(s.leaveRule(_n(rules['longDays'])), style: TextStyle(color: muted, fontSize: 14)),
      SectionTitle(s.leavesThisSession),
      if (leaves.isEmpty)
        EmptyLine(s.noLeaveYet)
      else
        for (final l in leaves) _LeaveTile(profile: _p, leave: l),
    ];
  }

  Future<void> _apply() async {
    final s = ref.read(stringsProvider);
    try {
      final rules = (await ref.read(leavesProvider(_p).future)).data;
      if (mounted) await _open(rules);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
      }
    }
  }

  Future<void> _open(Json rules) async {
    final s = ref.read(stringsProvider);
    final sent = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => FamilyPage(
          title: s.applyLeave,
          child: LeaveForm(profile: _p, rules: rules),
        ),
      ),
    );
    if (sent == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.leaveSent)));
      ref.invalidate(leavesProvider(_p));
      setState(() => _view = 'leave');
    }
  }
}

/// Present, on leave and absent as the parts of a ring, with the percentage present in the middle.
class _Ring extends ConsumerWidget {
  const _Ring({required this.present, required this.absent, required this.leave});
  final int present;
  final int absent;
  final int leave;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final pct = pctOf(present, present + absent + leave);
    return Semantics(
      key: const Key('attRing'),
      container: true,
      label:
          '${s.attendanceCode('P')} $present, ${s.attendanceCode('A')} $absent, '
          '${s.attendanceCode('LV')} $leave',
      excludeSemantics: true,
      child: SizedBox(
        width: 132,
        height: 132,
        child: Stack(
          alignment: Alignment.center,
          children: [
            CustomPaint(
              size: const Size.square(132),
              painter: _RingPainter(
                parts: [
                  (present, Tokens.statusSuccess),
                  (leave, Tokens.statusInfo),
                  (absent, Tokens.statusDanger),
                ],
                track: dark ? Tokens.mobGray700 : Tokens.mobGray100,
              ),
            ),
            // the words shrink to stay inside the ring with large text
            Padding(
              padding: const EdgeInsets.all(22),
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      pct == null ? '–' : '$pct%',
                      style: const TextStyle(fontSize: 22, fontWeight: Tokens.fwBold),
                    ),
                    Text(s.presentWord, style: const TextStyle(fontSize: 12)),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter({required this.parts, required this.track});
  final List<(int, Color)> parts;
  final Color track;

  @override
  void paint(Canvas canvas, Size size) {
    const stroke = 15.0;
    final rect = Rect.fromLTWH(stroke / 2, stroke / 2, size.width - stroke, size.height - stroke);
    final paint = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke;
    canvas.drawArc(rect, 0, 2 * math.pi, false, paint..color = track);
    final total = parts.fold<int>(0, (n, x) => n + x.$1);
    if (total == 0) return;
    var start = -math.pi / 2;
    for (final (n, color) in parts) {
      if (n == 0) continue;
      final sweep = 2 * math.pi * n / total;
      canvas.drawArc(rect, start, sweep, false, paint..color = color);
      start += sweep;
    }
  }

  @override
  bool shouldRepaint(_RingPainter old) => old.parts != parts || old.track != track;
}

/// The session month by month: a bar per month, present at the bottom, then leave, then absent, with the
/// percentage over it (the list below has the same numbers for the screen reader).
class _YearBars extends ConsumerWidget {
  const _YearBars({required this.months});
  final List<Json> months;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    return Semantics(
      key: const Key('attBars'),
      container: true,
      label: s.monthBarsLabel,
      excludeSemantics: true,
      child: SizedBox(
        height: 190,
        width: double.infinity,
        child: CustomPaint(
          painter: _BarsPainter(
            months: [
              for (final m in months)
                (
                  s.monthShort(DateTime.tryParse('${m['month']}-01') ?? DateTime.now()),
                  _n(m['days']),
                  _n(m['present']),
                  _n(m['leave']),
                  _n(m['absent']),
                ),
            ],
            ink: dark ? Tokens.mobWhite : Tokens.textBody,
            axis: dark ? Tokens.mobGray700 : Tokens.mobGray200,
          ),
        ),
      ),
    );
  }
}

class _BarsPainter extends CustomPainter {
  _BarsPainter({required this.months, required this.ink, required this.axis});

  /// label, school days, present, leave, absent
  final List<(String, int, int, int, int)> months;
  final Color ink;
  final Color axis;

  void _text(Canvas canvas, String t, Offset centre, {bool bold = false}) {
    final tp = TextPainter(
      text: TextSpan(
        text: t,
        style: TextStyle(
          color: ink,
          fontSize: 11,
          fontWeight: bold ? Tokens.fwSemibold : Tokens.fwRegular,
        ),
      ),
      textDirection: TextDirection.ltr,
    )..layout();
    tp.paint(canvas, centre - Offset(tp.width / 2, tp.height / 2));
  }

  @override
  void paint(Canvas canvas, Size size) {
    if (months.isEmpty) return;
    final base = size.height - 22;
    const top = 18.0;
    final most = math.max(1, months.map((m) => m.$2).fold<int>(0, math.max));
    final step = size.width / months.length;
    final bar = math.min(28.0, step * 0.6);
    double h(int n) => (base - top) * n / most;
    canvas.drawLine(
      Offset(0, base),
      Offset(size.width, base),
      Paint()
        ..color = axis
        ..strokeWidth = 1,
    );
    for (var i = 0; i < months.length; i++) {
      final (label, days, present, leave, absent) = months[i];
      final cx = step * i + step / 2;
      var y = base;
      for (final (n, color) in [
        (present, Tokens.statusSuccess),
        (leave, Tokens.statusInfo),
        (absent, Tokens.statusDanger),
      ]) {
        if (n == 0) continue;
        canvas.drawRect(Rect.fromLTWH(cx - bar / 2, y - h(n), bar, h(n)), Paint()..color = color);
        y -= h(n);
      }
      final pct = pctOf(present, days);
      if (pct != null) _text(canvas, '$pct%', Offset(cx, y - 9), bold: true);
      _text(canvas, label, Offset(cx, base + 11));
    }
  }

  @override
  bool shouldRepaint(_BarsPainter old) =>
      old.months != months || old.ink != ink || old.axis != axis;
}

/// What the colours mean (the screen reader reads each day's word instead).
class _Legend extends ConsumerWidget {
  const _Legend();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return ExcludeSemantics(
      child: Wrap(
        spacing: Tokens.sp4,
        runSpacing: Tokens.sp1,
        children: [
          for (final (label, color) in [
            (s.attendanceCode('P'), Tokens.statusSuccess),
            (s.attendanceCode('A'), Tokens.statusDanger),
            (s.attendanceCode('LV'), Tokens.statusInfo),
            (s.lateOrPart, Tokens.statusWarning),
          ])
            Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(color: color, shape: BoxShape.circle),
                ),
                const SizedBox(width: Tokens.sp1),
                Flexible(child: Text(label, style: const TextStyle(fontSize: 13))),
              ],
            ),
        ],
      ),
    );
  }
}

/// The month as a calendar: each day with its attendance colour and word (read out by the screen reader).
class _MonthGrid extends ConsumerWidget {
  const _MonthGrid({required this.month, required this.days});
  final DateTime month;
  final Map<String, Json> days;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final first = DateTime(month.year, month.month);
    final count = DateTime(month.year, month.month + 1, 0).day;
    final cells = <Widget?>[
      for (var i = 1; i < first.weekday; i++) null,
      for (var d = 1; d <= count; d++) _cell(context, s, DateTime(month.year, month.month, d)),
    ];
    while (cells.length % 7 != 0) {
      cells.add(null);
    }
    // plain rows of seven square days (not a grid that scrolls inside the page's list)
    return Column(
      children: [
        Row(
          children: [
            for (var w = 1; w <= 7; w++)
              Expanded(
                child: Center(
                  child: ExcludeSemantics(
                    child: Text(s.weekday(w), style: Theme.of(context).textTheme.labelSmall),
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: Tokens.sp1),
        for (var i = 0; i < cells.length; i += 7)
          Row(
            children: [
              for (final c in cells.sublist(i, i + 7))
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.all(2),
                    child: AspectRatio(aspectRatio: 1, child: c ?? const SizedBox()),
                  ),
                ),
            ],
          ),
      ],
    );
  }

  Widget _cell(BuildContext context, S s, DateTime d) {
    final code = '${days[ymd(d)]?['code'] ?? ''}';
    final (bg, dot) = code.isEmpty
        ? (Colors.transparent, Colors.transparent)
        : switch (attendanceTone(code)) {
            Tone.success => (Tokens.statusSuccessBg, Tokens.statusSuccess),
            Tone.danger => (Tokens.statusDangerBg, Tokens.statusDanger),
            Tone.warning => (Tokens.statusWarningBg, Tokens.statusWarning),
            _ => (Tokens.statusInfoBg, Tokens.statusInfo),
          };
    return Semantics(
      container: true,
      label: '${s.date(d)}: ${code.isEmpty ? '—' : s.attendanceCode(code)}',
      excludeSemantics: true,
      child: Container(
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(Tokens.radiusSm)),
        // a day is a small square: with large text its number and code shrink to fit (the screen reader reads
        // the whole day and its status from the label)
        padding: const EdgeInsets.all(2),
        child: FittedBox(
          fit: BoxFit.scaleDown,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // on a tinted day the text is the body colour (the tints stay light in dark mode too); the dot
              // carries the status colour
              Text(
                '${d.day}',
                style: TextStyle(
                  color: code.isEmpty
                      ? Theme.of(context).colorScheme.onSurfaceVariant
                      : Tokens.textBody,
                ),
              ),
              if (code.isNotEmpty)
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 2),
                    Text(
                      code,
                      style: const TextStyle(
                        fontSize: 10,
                        color: Tokens.textBody,
                        fontWeight: Tokens.fwBold,
                      ),
                    ),
                  ],
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One leave as the website lists it: the kind and the days, its number, the reason, the certificate, the
/// school's note, who has it now, and Cancel (or, once it has begun, "end the leave today").
class _LeaveTile extends ConsumerWidget {
  const _LeaveTile({required this.profile, required this.leave});
  final Profile profile;
  final Json leave;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    final status = '${leave['status']}';
    final days = _n(leave['days']);
    final from = '${leave['fromDate'] ?? ''}';
    final to = '${leave['toDate'] ?? ''}';
    final today = ymd(DateTime.now());
    final files = [for (final f in (leave['fileIds'] as List? ?? const [])) '$f'];
    final waiting = status == 'pending' && leave['waitingOn'] != null;
    final canCancel =
        status == 'pending' ||
        (status == 'approved' && leave['endedOn'] == null && to.compareTo(today) >= 0);
    // before it begins (or while it waits) it is cancelled; once begun, it ends today
    final ends = !(status == 'pending' || from.compareTo(today) > 0);
    return Card(
      key: Key('leave-${leave['id']}'),
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp1,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  '${leave['leaveTypeLabel'] ?? ''} · '
                  '${from == to ? s.date(from) : '${s.date(from)} – ${s.date(to)}'}',
                  style: const TextStyle(fontWeight: Tokens.fwBold),
                ),
                StatusChip(
                  waiting ? s.withWhom('${leave['waitingOn']}') : s.leaveStatus(status),
                  leaveTone(status),
                ),
              ],
            ),
            const SizedBox(height: Tokens.sp1),
            Text(
              [
                '${leave['number'] ?? ''}',
                s.daysN(days),
                if (leave['long'] == true) s.longLeave,
              ].where((x) => x.isNotEmpty).join(' · '),
              style: TextStyle(color: muted, fontSize: 14),
            ),
            if ('${leave['reason'] ?? ''}'.isNotEmpty) ...[
              const SizedBox(height: Tokens.sp1),
              Text('${leave['reason']}'),
            ],
            if (files.isNotEmpty) ...[
              const SizedBox(height: Tokens.sp2),
              Attachments(
                count: files.length,
                load: (i) =>
                    ref.read(apiProvider).leaveMyFile(id: '${leave['id']}', fileId: files[i]),
              ),
            ],
            if (leave['decisionNote'] != null)
              Text(
                s.noteFromSchool('${leave['decisionNote']}'),
                style: TextStyle(color: muted, fontSize: 14),
              ),
            if (leave['endedOn'] != null)
              Text(
                s.endedEarly(s.date(leave['endedOn'])),
                style: TextStyle(color: muted, fontSize: 14),
              ),
            if (canCancel)
              Align(
                alignment: AlignmentDirectional.centerEnd,
                child: OutlinedButton(
                  key: Key('cancelLeave-${leave['id']}'),
                  onPressed: () => _cancel(context, ref, s, ends),
                  child: Text(ends ? s.endLeaveToday : s.cancelLeave),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _cancel(BuildContext context, WidgetRef ref, S s, bool ends) async {
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(ends ? s.endLeaveAsk : s.cancelLeaveAsk),
        actions: [
          TextButton(onPressed: () => Navigator.of(c).pop(false), child: Text(s.close)),
          FilledButton(
            key: const Key('confirmCancelLeave'),
            onPressed: () => Navigator.of(c).pop(true),
            child: Text(ends ? s.endLeaveToday : s.cancelLeave),
          ),
        ],
      ),
    );
    if (yes != true) return;
    try {
      await ref.read(apiProvider).leaveCancel(id: '${leave['id']}');
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.leaveCancelled)));
      }
      ref.invalidate(leavesProvider(profile));
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(errorText(s, e))));
      }
    }
  }
}

/// A leave application for the child, as on the website: the kind (type to search), the days, the reason and
/// the certificate or letter (PDF or photo, up to 5 MB each), sent from the phone.
class LeaveForm extends ConsumerStatefulWidget {
  const LeaveForm({super.key, required this.profile, required this.rules});
  final Profile profile;
  final Json rules;

  @override
  ConsumerState<LeaveForm> createState() => _LeaveFormState();
}

class _LeaveFormState extends ConsumerState<LeaveForm> {
  String? _type;
  late DateTime _from = DateTime.now();
  late DateTime _to = DateTime.now();
  final _reason = TextEditingController();
  final _files = <PickedFile>[];
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  int get _days => _to.difference(_from).inDays + 1;

  bool get _needsCertificate {
    final t = asList(widget.rules['types']).where((x) => '${x['value']}' == _type).firstOrNull;
    final c = t?['certificate'];
    if (c == null || c == 'never') return false;
    return c == 'always' || _days > _n(widget.rules['longDays']);
  }

  Future<void> _pick(bool first) async {
    final today = DateTime.now();
    final back = _n(widget.rules['backDays']);
    final d = await showDatePicker(
      context: context,
      initialDate: first ? _from : _to,
      firstDate: first ? today.subtract(Duration(days: back)) : _from,
      lastDate: today.add(const Duration(days: 365)),
    );
    if (d == null) return;
    setState(() {
      if (first) {
        _from = d;
        if (_to.isBefore(d)) _to = d;
      } else {
        _to = d;
      }
    });
  }

  Future<void> _addFiles() async {
    final s = ref.read(stringsProvider);
    final picked = await ref.read(leaveFilePickerProvider)();
    String? error;
    final ok = <PickedFile>[];
    for (final f in picked) {
      if (!RegExp(r'^(application/pdf|image/(png|jpeg|webp))$').hasMatch(f.contentType)) {
        error = s.leaveFileType;
      } else if (f.bytes.length > 5 * 1024 * 1024) {
        error = s.leaveFileTooBig;
      } else {
        ok.add(f);
      }
    }
    if (!mounted) return;
    setState(() {
      _files.addAll(ok);
      _error = error;
    });
  }

  Future<void> _send() async {
    final s = ref.read(stringsProvider);
    if (_type == null) return setState(() => _error = s.chooseLeaveType);
    if (_reason.text.trim().length < 5) return setState(() => _error = s.reasonShort);
    if (_needsCertificate && _files.isEmpty) return setState(() => _error = s.addCertificate);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final api = ref.read(apiProvider);
      final ids = <String>[
        for (final f in _files) await uploadFile(api, ref.read(transportProvider), f),
      ];
      await api.leaveApply(
        body: LeaveApplyDto(
          studentId: widget.profile.studentId!,
          leaveType: _type!,
          fromDate: ymd(_from),
          toDate: ymd(_to),
          reason: _reason.text.trim(),
          fileIds: ids.isEmpty ? null : ids,
        ),
      );
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      setState(() {
        _busy = false;
        _error = errorText(s, e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    final types = asList(widget.rules['types']);
    final certRules = [
      for (final t in types)
        if (t['certificate'] != null && t['certificate'] != 'never')
          '${t['label']}: ${t['certificate'] == 'always' ? s.certAlways : s.certLong(_n(widget.rules['longDays']))}',
    ];
    return ListView(
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        DropdownMenu<String>(
          key: const Key('leaveType'),
          label: Text(s.leaveType),
          trailingIcon: dropArrow(s.leaveType),
          selectedTrailingIcon: dropArrow(s.leaveType, open: true),
          expandedInsets: EdgeInsets.zero,
          enableFilter: true,
          enableSearch: true,
          requestFocusOnTap: true,
          onSelected: (v) => setState(() => _type = v),
          dropdownMenuEntries: [
            for (final t in types)
              DropdownMenuEntry(value: '${t['value']}', label: '${t['label']}'),
          ],
        ),
        const SizedBox(height: Tokens.sp4),
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          children: [
            OutlinedButton.icon(
              key: const Key('leaveFrom'),
              icon: const Icon(Icons.event),
              label: Text('${s.fromDate}: ${s.date(_from)}'),
              onPressed: () => _pick(true),
            ),
            OutlinedButton.icon(
              key: const Key('leaveTo'),
              icon: const Icon(Icons.event),
              label: Text('${s.toDate}: ${s.date(_to)}'),
              onPressed: () => _pick(false),
            ),
          ],
        ),
        const SizedBox(height: Tokens.sp2),
        Text(s.daysN(_days)),
        const SizedBox(height: Tokens.sp4),
        TextField(
          key: const Key('leaveReason'),
          controller: _reason,
          maxLines: 4,
          maxLength: 1000,
          decoration: InputDecoration(labelText: s.reason, border: const OutlineInputBorder()),
        ),
        Text(s.certificateFile, style: const TextStyle(fontWeight: Tokens.fwSemibold)),
        if (certRules.isNotEmpty)
          Text(certRules.join(' · '), style: TextStyle(color: muted, fontSize: 14)),
        const SizedBox(height: Tokens.sp2),
        if (_needsCertificate) ...[
          Notice(text: s.certificateNeeded),
          const SizedBox(height: Tokens.sp2),
        ],
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            for (var i = 0; i < _files.length; i++)
              InputChip(
                key: Key('leaveFile-$i'),
                avatar: const Icon(Icons.attach_file, size: 18),
                label: Text(_files[i].name),
                deleteButtonTooltipMessage: s.removeFile(_files[i].name),
                onDeleted: () => setState(() => _files.removeAt(i)),
              ),
            OutlinedButton.icon(
              key: const Key('leaveAddFile'),
              icon: const Icon(Icons.upload_file),
              label: Text(s.addFile),
              onPressed: _busy ? null : _addFiles,
            ),
          ],
        ),
        const SizedBox(height: Tokens.sp4),
        Text(
          s.leaveRule(_n(widget.rules['longDays'])),
          style: TextStyle(color: muted, fontSize: 14),
        ),
        const SizedBox(height: Tokens.sp4),
        if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp3)],
        FilledButton(
          key: const Key('sendLeave'),
          onPressed: _busy ? null : _send,
          child: Text(s.send),
        ),
      ],
    );
  }
}
