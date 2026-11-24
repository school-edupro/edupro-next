import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart' show ApiException;
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/file_screen.dart';
import '../ui/widgets.dart';
import 'data.dart';

/// The words of Bus attendance (as the staff website's, in English and Hindi).
extension BusWords on S {
  String _bw(String en, String hi) => hindi ? hi : en;

  String get busRouteTrip => _bw('Route and trip', 'मार्ग और यात्रा');
  String get busDate => _bw('Date', 'तिथि');
  String get busCodesHelp => _bw(
    'P on the bus · A not on the bus · LV on leave · GP gate pass (left early or comes late) · OT other arrangement (a parent brings or collects).',
    'P बस में · A बस में नहीं · LV छुट्टी पर · GP गेट पास (जल्दी गया या देर से आएगा) · OT अन्य व्यवस्था (अभिभावक लाते या ले जाते हैं)।',
  );
  String get busNoRoute => _bw(
    'No route is mapped to you for bus attendance. The coordinator maps a teacher to each route for the morning and the afternoon trip under Attendance → Set-up.',
    'बस उपस्थिति के लिए आपको कोई मार्ग नहीं दिया गया है। समन्वयक उपस्थिति → सेट-अप में हर मार्ग की सुबह और दोपहर की यात्रा के लिए शिक्षक तय करते हैं।',
  );
  String get busNotYours =>
      _bw('Bus attendance is not part of your role.', 'बस उपस्थिति आपकी भूमिका में नहीं है।');
  String busCounts(Json c, String? by, bool late) => _bw(
    '${c['P'] ?? 0} on the bus · ${c['A'] ?? 0} not on the bus · ${c['LV'] ?? 0} leave · ${c['GP'] ?? 0} gate pass · marked by ${by ?? '—'}${late ? ' (late)' : ''}',
    '${c['P'] ?? 0} बस में · ${c['A'] ?? 0} बस में नहीं · ${c['LV'] ?? 0} छुट्टी · ${c['GP'] ?? 0} गेट पास · ${by ?? '—'} द्वारा${late ? ' (देर से)' : ''}',
  );
  String get busNotMarked =>
      _bw('Not marked yet for this trip.', 'इस यात्रा की उपस्थिति अभी नहीं ली गई।');
  String busRiders(int n) => _bw('$n riders', '$n सवार');
  String busWindow(String? from, String? to) => _bw(
    'Marking is open ${from ?? 'from the start of the day'} – ${to ?? 'the end of the day'}.',
    'उपस्थिति ${from ?? 'दिन की शुरुआत'} – ${to ?? 'दिन के अंत'} तक ली जा सकती है।',
  );
  String get busNoRiders => _bw(
    'No pupil rides this route on this trip.',
    'इस यात्रा में इस मार्ग पर कोई विद्यार्थी नहीं।',
  );
  String busLeave(bool locked) => locked
      ? _bw('On leave (approved): cannot be changed', 'छुट्टी पर (स्वीकृत): बदली नहीं जा सकती')
      : _bw('On leave (approved)', 'छुट्टी पर (स्वीकृत)');
  String busPass(String kind, String? at) =>
      '${kind == 'early_leave' ? _bw('Gate pass: leaves early', 'गेट पास: जल्दी जाएगा') : _bw('Gate pass: comes late', 'गेट पास: देर से आएगा')}${at != null ? ' $at' : ''}';
  String busCardRead(String t) => _bw('card read $t', 'कार्ड पढ़ा गया $t');
  String busClassCode(String c) => switch (c) {
    'P' => _bw('present in class', 'कक्षा में उपस्थित'),
    'A' => _bw('absent in class', 'कक्षा में अनुपस्थित'),
    'L' => _bw('late in class', 'कक्षा में देर से'),
    'LV' => _bw('on leave', 'छुट्टी पर'),
    'SR' => _bw('short leave', 'अल्प अवकाश'),
    'H' => _bw('half day', 'आधा दिन'),
    'OD' => _bw('on duty', 'ड्यूटी पर'),
    'SB' => _bw('stay back', 'रुकना'),
    _ => c,
  };
  String busCode(String c) => switch (c) {
    'P' => _bw('On the bus', 'बस में'),
    'A' => _bw('Not on the bus', 'बस में नहीं'),
    'LV' => _bw('On leave', 'छुट्टी पर'),
    'GP' => _bw('Gate pass', 'गेट पास'),
    _ => _bw('Other arrangement', 'अन्य व्यवस्था'),
  };
  String busRemarks(String name) => _bw('Remarks · $name', 'टिप्पणी · $name');
  String busSave(bool update) => update
      ? _bw('Update bus attendance', 'बस उपस्थिति अद्यतन करें')
      : _bw('Save bus attendance', 'बस उपस्थिति सहेजें');
  String get busSaved => _bw('Bus attendance saved.', 'बस उपस्थिति सहेजी गई।');
  String get busRegister => _bw('Monthly register', 'मासिक रजिस्टर');
  String busRegisterOf(String month) => _bw('Register of $month', '$month का रजिस्टर');
  String get busRegisterHelp => _bw(
    'M morning (pick) · A afternoon (drop) · P on the bus · A not on the bus · LV leave · GP gate pass · OT other arrangement · – not marked · blank: does not ride that trip',
    'M सुबह · A दोपहर · P बस में · A बस में नहीं · LV छुट्टी · GP गेट पास · OT अन्य व्यवस्था · – नहीं ली गई · खाली: उस यात्रा में नहीं जाता',
  );
  String get busRegisterNone => _bw(
    'No bus attendance is marked on this route in this month yet.',
    'इस माह इस मार्ग पर अभी कोई बस उपस्थिति नहीं ली गई।',
  );
  String get busStudent => _bw('Student', 'विद्यार्थी');
  String get busTotals =>
      _bw('On bus · Not · Leave · Gate pass · Other', 'बस में · नहीं · छुट्टी · गेट पास · अन्य');
  String get saEarlierMonth => _bw('Earlier month', 'पिछला माह');
  String get saLaterMonth => _bw('Later month', 'अगला माह');
}

const _codes = ['P', 'A', 'LV', 'GP', 'OT'];

final busRoutesProvider = FutureProvider.autoDispose.family<Loaded<List<Json>>, Profile>((
  ref,
  p,
) async {
  final r = await cached('bus-routes:${p.id}', () => ref.read(apiProvider).busRollRoutes());
  return Loaded(asList(asJson(r.data)['data']), r.at, stale: r.stale);
});

/// One trip's roll: route, trip, date.
final busRollProvider = FutureProvider.autoDispose.family<Json, (String, String, String)>(
  (ref, k) async =>
      asJson(await ref.read(apiProvider).busRollGet(routeId: k.$1, trip: k.$2, date: k.$3)),
);

/// The month's register of a route (both trips).
final busRegisterProvider = FutureProvider.autoDispose.family<Json, (String, String)>(
  (ref, k) async =>
      asJson(await ref.read(apiProvider).busRollRegister(routeId: k.$1, trip: 'both', month: k.$2)),
);

/// Bus attendance as on the staff website: the teacher mapped to a route marks the morning (pick) and the afternoon
/// (drop) trip of a day. The list is the route's approved riders; an approved leave or a gate pass of the day is
/// filled in already (an approved leave cannot be changed); the school's marking window applies. The month's register
/// opens from here, with its Excel and PDF. No web page.
class BusAttendanceScreen extends ConsumerStatefulWidget {
  const BusAttendanceScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<BusAttendanceScreen> createState() => _BusAttendanceScreenState();
}

class _BusAttendanceScreenState extends ConsumerState<BusAttendanceScreen> {
  String? _pick;
  late DateTime _date = schoolToday();

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final value = ref.watch(busRoutesProvider(widget.profile));
    if (value.error is ApiException && (value.error as ApiException).status == 403) {
      return Padding(
        padding: const EdgeInsets.all(Tokens.sp4),
        child: Notice(text: s.busNotYours),
      );
    }
    return LoadedList<List<Json>>(
      value: value,
      refresh: () => ref.refresh(busRoutesProvider(widget.profile).future),
      children: (routes) {
        if (routes.isEmpty) return [Notice(text: s.busNoRoute)];
        String key(Json r) => '${r['routeId']}|${r['trip']}';
        final chosen = routes.firstWhere((r) => key(r) == _pick, orElse: () => routes.first);
        final month = ymd(_date).substring(0, 7);
        final api = ref.read(apiProvider);
        return [
          DropdownMenu<String>(
            key: const Key('busPick'),
            label: Text(s.busRouteTrip),
            trailingIcon: dropArrow(s.busRouteTrip),
            selectedTrailingIcon: dropArrow(s.busRouteTrip, open: true),
            expandedInsets: EdgeInsets.zero,
            enableFilter: true,
            enableSearch: true,
            requestFocusOnTap: true,
            initialSelection: key(chosen),
            onSelected: (v) => setState(() => _pick = v),
            dropdownMenuEntries: [
              for (final r in routes)
                DropdownMenuEntry(
                  value: key(r),
                  label: '${r['code']} · ${r['name']} · ${r['tripLabel']}',
                ),
            ],
          ),
          const SizedBox(height: Tokens.sp3),
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp2,
            children: [
              OutlinedButton.icon(
                key: const Key('busDate'),
                icon: const Icon(Icons.event),
                label: Text('${s.busDate}: ${s.dayShort(_date)}'),
                onPressed: () async {
                  final today = schoolToday();
                  final d = await showDatePicker(
                    context: context,
                    initialDate: _date,
                    firstDate: today.subtract(const Duration(days: 366)),
                    lastDate: today,
                  );
                  if (d != null) setState(() => _date = d);
                },
              ),
              OutlinedButton.icon(
                key: const Key('busRegister'),
                icon: const Icon(Icons.table_view_outlined),
                label: Text(s.busRegister),
                onPressed: () => pushPage(
                  context,
                  s.busRegister,
                  BusRegisterScreen(routes: routes, routeId: '${chosen['routeId']}', month: _date),
                ),
              ),
            ],
          ),
          const SizedBox(height: Tokens.sp2),
          Text(s.busCodesHelp, style: const TextStyle(fontSize: 13)),
          Wrap(
            spacing: Tokens.sp2,
            children: [
              for (final (format, label, icon) in [
                ('xlsx', 'Excel', Icons.grid_on_outlined),
                ('pdf', 'PDF', Icons.picture_as_pdf_outlined),
              ])
                TextButton.icon(
                  key: Key('busFile-$format'),
                  icon: Icon(icon),
                  label: Text('${s.busRegisterOf(s.month(_date))} · $label'),
                  onPressed: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => FileScreen(
                        title: s.busRegisterOf(s.month(_date)),
                        load: () => api.busRollRegisterJson(
                          routeId: '${chosen['routeId']}',
                          trip: 'both',
                          month: month,
                          format: format,
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: Tokens.sp3),
          _Roll(
            key: ValueKey('${key(chosen)}|${ymd(_date)}'),
            routeId: '${chosen['routeId']}',
            trip: '${chosen['trip']}',
            tripLabel: '${chosen['tripLabel']}',
            date: ymd(_date),
          ),
        ];
      },
    );
  }
}

class _Roll extends ConsumerStatefulWidget {
  const _Roll({
    super.key,
    required this.routeId,
    required this.trip,
    required this.tripLabel,
    required this.date,
  });
  final String routeId;
  final String trip;
  final String tripLabel;
  final String date;

  @override
  ConsumerState<_Roll> createState() => _RollState();
}

class _RollState extends ConsumerState<_Roll> {
  final Map<String, String> _codesOf = {};
  final Map<String, TextEditingController> _remarks = {};
  bool _seeded = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final c in _remarks.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _seed(List<Json> roster) {
    if (_seeded) return;
    _seeded = true;
    for (final r in roster) {
      final id = '${r['studentId']}';
      _codesOf[id] = r['locked'] == true ? 'LV' : '${r['code'] ?? r['suggested'] ?? 'P'}';
      _remarks[id] = TextEditingController(text: '${r['remarks'] ?? ''}');
    }
  }

  Future<void> _save(List<Json> roster) async {
    final s = ref.read(stringsProvider);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .busRollMark(
            body: BusRollMarkDto(
              routeId: widget.routeId,
              date: widget.date,
              trip: widget.trip,
              marks: [
                for (final r in roster)
                  BusRollMarkDtoMarksItem(
                    studentId: '${r['studentId']}',
                    code: _codesOf['${r['studentId']}'] ?? 'P',
                    remarks: (_remarks['${r['studentId']}']?.text.trim() ?? '').isEmpty
                        ? null
                        : _remarks['${r['studentId']}']!.text.trim(),
                  ),
              ],
            ),
          );
      _seeded = false;
      ref.invalidate(busRollProvider((widget.routeId, widget.trip, widget.date)));
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.busSaved)));
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
    final value = ref.watch(busRollProvider((widget.routeId, widget.trip, widget.date)));
    return switch (value) {
      AsyncValue(:final value?) => () {
        final roster = asList(value['roster']);
        _seed(roster);
        final window = asJson(value['window']);
        final closed = window['open'] == false;
        return Column(
          key: const Key('busRoll'),
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              [
                value['route'],
                s.dayShort(DateTime.parse(widget.date)),
                value['vehicle'],
              ].where((x) => x != null).join(' · '),
              style: const TextStyle(fontWeight: Tokens.fwBold),
            ),
            Text(
              value['id'] != null
                  ? s.busCounts(
                      asJson(value['counts']),
                      value['markedBy'] as String?,
                      value['markedLate'] == true,
                    )
                  : s.busNotMarked,
              style: TextStyle(color: muted, fontSize: 13),
            ),
            Text(s.busRiders(roster.length), style: TextStyle(color: muted, fontSize: 13)),
            const SizedBox(height: Tokens.sp2),
            if (window['note'] != null)
              Notice(text: '${window['note']}')
            else if (window['from'] != null || window['to'] != null)
              Text(s.busWindow(window['from'] as String?, window['to'] as String?)),
            const SizedBox(height: Tokens.sp2),
            if (roster.isEmpty) Notice(text: s.busNoRiders),
            for (final r in roster) _rider(s, r, closed, muted),
            if (_error != null) ErrorText(_error!),
            if (!closed && roster.isNotEmpty) ...[
              const SizedBox(height: Tokens.sp3),
              FilledButton(
                key: const Key('busSave'),
                onPressed: _busy ? null : () => _save(roster),
                child: Text(s.busSave(value['id'] != null)),
              ),
            ],
          ],
        );
      }(),
      AsyncValue(:final error?) => ErrorText(errorText(s, error)),
      _ => const LinearProgressIndicator(),
    };
  }

  Widget _rider(S s, Json r, bool closed, Color muted) {
    final id = '${r['studentId']}';
    final hint = asJson(r['hint']);
    final pass = asJson(hint['pass']);
    final locked = r['locked'] == true;
    final note = [
      if (r['classCode'] != null) s.busClassCode('${r['classCode']}'),
      if (r['tapped'] != null) s.busCardRead('${r['tapped']}'),
    ];
    return Card(
      key: Key('busRider-$id'),
      margin: const EdgeInsets.only(bottom: Tokens.sp2),
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp3),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${r['name']}', style: const TextStyle(fontWeight: Tokens.fwSemibold)),
            Text(
              [
                r['section'],
                r['admissionNo'],
                r['stop'],
                r['atTime'],
              ].where((x) => x != null).join(' · '),
              style: TextStyle(color: muted, fontSize: 13),
            ),
            if (hint['leave'] != null || pass.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: Tokens.sp1),
                child: Wrap(
                  spacing: Tokens.sp2,
                  runSpacing: Tokens.sp1,
                  children: [
                    if (hint['leave'] != null) Tag(s.busLeave(locked), color: Tokens.mobCyan100),
                    if (pass.isNotEmpty)
                      Tag(
                        s.busPass('${pass['kind']}', pass['atTime'] as String?),
                        color: Tokens.mobAmber50,
                      ),
                  ],
                ),
              ),
            if (note.isNotEmpty)
              Text(note.join(' · '), style: TextStyle(color: muted, fontSize: 13)),
            const SizedBox(height: Tokens.sp2),
            Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp1,
              children: [
                for (final c in _codes)
                  Tooltip(
                    message: s.busCode(c),
                    child: ChoiceChip(
                      key: Key('bus-$id-$c'),
                      label: Text(c),
                      selected: _codesOf[id] == c,
                      onSelected: closed || (locked && c != 'LV')
                          ? null
                          : (_) => setState(() => _codesOf[id] = c),
                    ),
                  ),
              ],
            ),
            TextField(
              key: Key('busRemarks-$id'),
              controller: _remarks[id],
              enabled: !closed,
              maxLength: 200,
              decoration: InputDecoration(labelText: s.busRemarks('${r['name']}'), counterText: ''),
            ),
          ],
        ),
      ),
    );
  }
}

/// The month's bus register of a route: a row per student, the morning (M) and afternoon (A) of each day, the
/// totals; with Excel and PDF.
class BusRegisterScreen extends ConsumerStatefulWidget {
  const BusRegisterScreen({
    super.key,
    required this.routes,
    required this.routeId,
    required this.month,
  });
  final List<Json> routes;
  final String routeId;
  final DateTime month;

  @override
  ConsumerState<BusRegisterScreen> createState() => _BusRegisterScreenState();
}

class _BusRegisterScreenState extends ConsumerState<BusRegisterScreen> {
  late String _route = widget.routeId;
  late DateTime _month = DateTime(widget.month.year, widget.month.month);

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final month = ymd(_month).substring(0, 7);
    final routes = <String, Json>{for (final r in widget.routes) '${r['routeId']}': r};
    final value = ref.watch(busRegisterProvider((_route, month)));
    final api = ref.read(apiProvider);
    return ListView(
      key: const Key('busRegisterScreen'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        DropdownMenu<String>(
          key: const Key('busRegRoute'),
          label: Text(s.busRouteTrip),
          trailingIcon: dropArrow(s.busRouteTrip),
          selectedTrailingIcon: dropArrow(s.busRouteTrip, open: true),
          expandedInsets: EdgeInsets.zero,
          enableFilter: true,
          enableSearch: true,
          requestFocusOnTap: true,
          initialSelection: _route,
          onSelected: (v) => setState(() => _route = v ?? _route),
          dropdownMenuEntries: [
            for (final r in routes.values)
              DropdownMenuEntry(value: '${r['routeId']}', label: '${r['code']} · ${r['name']}'),
          ],
        ),
        const SizedBox(height: Tokens.sp2),
        Row(
          children: [
            IconButton(
              key: const Key('busRegPrev'),
              tooltip: s.saEarlierMonth,
              icon: const Icon(Icons.chevron_left),
              onPressed: () => setState(() => _month = DateTime(_month.year, _month.month - 1)),
            ),
            Expanded(
              child: Text(
                s.month(_month),
                textAlign: TextAlign.center,
                style: const TextStyle(fontWeight: Tokens.fwSemibold),
              ),
            ),
            IconButton(
              key: const Key('busRegNext'),
              tooltip: s.saLaterMonth,
              icon: const Icon(Icons.chevron_right),
              onPressed: () => setState(() => _month = DateTime(_month.year, _month.month + 1)),
            ),
          ],
        ),
        Wrap(
          spacing: Tokens.sp2,
          children: [
            for (final (format, label, icon) in [
              ('xlsx', 'Excel', Icons.grid_on_outlined),
              ('pdf', 'PDF', Icons.picture_as_pdf_outlined),
            ])
              TextButton.icon(
                key: Key('busRegFile-$format'),
                icon: Icon(icon),
                label: Text(label),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => FileScreen(
                      title: s.busRegisterOf(s.month(_month)),
                      load: () => api.busRollRegisterJson(
                        routeId: _route,
                        trip: 'both',
                        month: month,
                        format: format,
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: Tokens.sp2),
        switch (value) {
          AsyncValue(:final value?) => _grid(s, value, muted),
          AsyncValue(:final error?) => ErrorText(errorText(s, error)),
          _ => const LinearProgressIndicator(),
        },
        const SizedBox(height: Tokens.sp2),
        Text(s.busRegisterHelp, style: TextStyle(color: muted, fontSize: 12)),
      ],
    );
  }

  Widget _grid(S s, Json reg, Color muted) {
    // plain strings (asList keeps only objects)
    final days = [for (final d in (reg['days'] is List ? reg['days'] as List : const [])) '$d'];
    if (days.isEmpty) return Notice(text: s.busRegisterNone);
    final trips = [for (final t in (reg['trips'] is List ? reg['trips'] as List : const [])) '$t'];
    final rows = asList(reg['rows']);
    TableCell cell(String text, {bool bold = false}) => TableCell(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
        child: Text(
          text,
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 12, fontWeight: bold ? Tokens.fwBold : Tokens.fwRegular),
        ),
      ),
    );
    return Semantics(
      label: s.busRegister,
      child: SingleChildScrollView(
        key: const Key('busRegGrid'),
        scrollDirection: Axis.horizontal,
        child: Table(
          defaultColumnWidth: const IntrinsicColumnWidth(),
          border: TableBorder.all(color: muted.withValues(alpha: 0.3)),
          children: [
            TableRow(
              children: [
                cell(s.busStudent, bold: true),
                for (final d in days)
                  for (final t in trips)
                    cell('${d.substring(8)} ${t == 'pick' ? 'M' : 'A'}', bold: true),
                cell(s.busTotals, bold: true),
              ],
            ),
            for (final r in rows)
              TableRow(
                children: [
                  cell('${r['name']}${r['section'] != null ? ' (${r['section']})' : ''}'),
                  for (final d in days)
                    for (final t in trips)
                      cell(
                        (r['rides'] is List && !(r['rides'] as List).contains(t))
                            ? ''
                            : '${asJson(r[t])[d] ?? '–'}',
                      ),
                  cell(
                    '${(trips.length == 2) ? '${r['presentPick']}/${r['presentDrop']}' : r['present']} · ${r['absent']} · ${r['leave']} · ${r['gatePass']} · ${r['other']}',
                  ),
                ],
              ),
          ],
        ),
      ),
    );
  }
}
