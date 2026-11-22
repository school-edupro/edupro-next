import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../api/outbox.dart';
import '../app_services.dart';
import '../family/attendance.dart' show attendanceTone;
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/file_screen.dart';
import '../ui/outbox_view.dart';
import '../ui/widgets.dart';
import 'data.dart';

/// A class the person may mark: a section's day attendance, or one subject's.
class MarkOption {
  const MarkOption(this.sectionId, this.subjectId, this.label);
  final String sectionId;
  final String? subjectId;
  final String label;
  String get key => '$sectionId|${subjectId ?? ''}';
}

String sectionName(Json a) => a['section'] != null && a['classCode'] != null
    ? '${a['classCode']}-${a['section']}'
    : '${a['section'] ?? a['classSectionId']}';

/// The classes from the person's assignments: day attendance where they may mark it, each subject they teach.
List<MarkOption> markOptions(List<Json> assignments, S s) {
  final out = <String, MarkOption>{};
  for (final a in assignments) {
    final section = '${a['classSectionId']}';
    final subject = a['subjectId'] as String?;
    if (subject == null && a['canMarkAttendance'] != true) continue;
    final o = MarkOption(
      section,
      subject,
      '${sectionName(a)} · ${subject == null ? s.dayAttendance : a['subjectName'] ?? a['subjectCode']}',
    );
    out[o.key] = o;
  }
  return out.values.toList()..sort((a, b) => a.label.compareTo(b.label));
}

const _codes = ['P', 'A', 'L', 'LV', 'SR', 'H', 'OD', 'SB'];

/// Marks a class for a day, as the staff website's register (docs/design/96, part 6): the codes, the day's saved counts
/// and who marked it, the marking window, each pupil's admission number, gate tap time, leave and gate-pass flags and a
/// remark, and the month's register as Excel or PDF for a day register. The roll is kept on the phone, and the marks
/// are kept and sent when there is no network (docs/design/89 §5.6), so a teacher in a room without signal still
/// takes the attendance.
class MarkClassScreen extends ConsumerStatefulWidget {
  const MarkClassScreen({super.key, required this.profile, this.sectionId, this.subjectId});
  final Profile profile;
  final String? sectionId;
  final String? subjectId;

  @override
  ConsumerState<MarkClassScreen> createState() => _MarkClassScreenState();
}

class _MarkClassScreenState extends ConsumerState<MarkClassScreen> {
  String? _option;
  DateTime _date = schoolToday();
  final Map<String, String> _marks = {};
  final Map<String, String> _remarks = {};
  final Set<String> _remarkOpen = {};
  String? _loadedFor;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    if (widget.sectionId != null) _option = '${widget.sectionId}|${widget.subjectId ?? ''}';
  }

  (Profile, String, String, String?)? get _arg {
    if (_option == null) return null;
    final [section, subject] = _option!.split('|');
    return (widget.profile, section, ymd(_date), subject.isEmpty ? null : subject);
  }

  void _fill(Json roll) {
    final key = '${_arg!.$2}|${_arg!.$3}|${_arg!.$4}';
    if (_loadedFor == key) return;
    _loadedFor = key;
    _marks
      ..clear()
      ..addAll({
        for (final r in asList(roll['roster']))
          '${r['studentId']}': r['locked'] == true ? 'LV' : '${r['code'] ?? r['suggested'] ?? 'P'}',
      });
    _remarkOpen.clear();
    _remarks
      ..clear()
      ..addAll({
        for (final r in asList(roll['roster']))
          if ((r['remarks'] ?? '').toString().isNotEmpty) '${r['studentId']}': '${r['remarks']}',
      });
  }

  Future<void> _pickDate() async {
    final today = schoolToday();
    final d = await showDatePicker(
      context: context,
      initialDate: _date,
      firstDate: today.subtract(const Duration(days: 60)),
      lastDate: today,
    );
    if (d != null) setState(() => _date = d);
  }

  Future<void> _save(Json roll, List<MarkOption> options) async {
    final s = ref.read(stringsProvider);
    final a = _arg!;
    final label = options.firstWhere((o) => o.key == _option).label;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final sent = await ref
          .read(outboxProvider.notifier)
          .send(
            label: '$label, ${s.date(_date)}',
            schoolId: widget.profile.schoolId,
            call: (api) => api.attendanceMark(
              body: MarkSessionDto(
                classSectionId: a.$2,
                date: a.$3,
                kind: a.$4 == null ? 'day' : 'subject',
                subjectId: a.$4,
                marks: [
                  for (final r in asList(roll['roster']))
                    MarkSessionDtoMarksItem(
                      studentId: '${r['studentId']}',
                      code: _marks['${r['studentId']}'] ?? 'P',
                      // a remark typed or kept (emptied: cleared)
                      remarks: _remarks['${r['studentId']}']?.trim(),
                    ),
                ],
              ),
            ),
          );
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(sent == Sent.now ? s.saved : s.savedOffline)));
      if (sent == Sent.now) {
        _loadedFor = null;
        ref.invalidate(rollProvider(a));
        ref.invalidate(daySummaryProvider((widget.profile, a.$3)));
      }
    } catch (e) {
      setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final assignments = ref.watch(assignmentsProvider(widget.profile));
    final options = markOptions(assignments.value?.data ?? const [], s);
    final arg = _arg;
    return ListView(
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        const OutboxBanner(),
        if (assignments.isLoading) const LinearProgressIndicator(),
        DropdownMenu<String>(
          key: const Key('markSection'),
          label: Text(s.section),
          trailingIcon: dropArrow(s.section),
          selectedTrailingIcon: dropArrow(s.section, open: true),
          expandedInsets: EdgeInsets.zero,
          enableFilter: true,
          enableSearch: true,
          requestFocusOnTap: true,
          initialSelection: _option,
          onSelected: (v) => setState(() {
            _option = v;
            _loadedFor = null;
          }),
          dropdownMenuEntries: [
            for (final o in options) DropdownMenuEntry(value: o.key, label: o.label),
          ],
        ),
        const SizedBox(height: Tokens.sp3),
        OutlinedButton.icon(
          key: const Key('markDate'),
          icon: const Icon(Icons.event),
          label: Text('${s.dateLabel}: ${s.dayShort(_date)}'),
          onPressed: () async {
            await _pickDate();
            setState(() => _loadedFor = null);
          },
        ),
        const SizedBox(height: Tokens.sp2),
        Text(s.attCodesHelp, style: Theme.of(context).textTheme.bodySmall),
        // the month's register of a day register, as the website's Excel and PDF links
        if (arg != null && arg.$4 == null) ...[
          const SizedBox(height: Tokens.sp2),
          Wrap(
            spacing: Tokens.sp2,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(s.registerOfMonth(s.month(_date))),
              for (final (format, label, icon) in [
                ('xlsx', 'Excel', Icons.table_chart_outlined),
                ('pdf', 'PDF', Icons.picture_as_pdf_outlined),
              ])
                TextButton.icon(
                  key: Key('register-$format'),
                  icon: Icon(icon),
                  label: Text(label),
                  onPressed: () {
                    final month = ymd(_date).substring(0, 7);
                    final api = ref.read(apiProvider);
                    Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => FileScreen(
                          title: s.registerOfMonth(s.month(_date)),
                          load: () => format == 'pdf'
                              ? api.attendanceDeskClassRegisterPdf(
                                  classSectionId: arg.$2,
                                  month: month,
                                )
                              : api.attendanceDeskClassRegisterXlsx(
                                  classSectionId: arg.$2,
                                  month: month,
                                ),
                        ),
                      ),
                    );
                  },
                ),
            ],
          ),
        ],
        const SizedBox(height: Tokens.sp3),
        if (arg != null)
          switch (ref.watch(rollProvider(arg))) {
            AsyncValue(:final value?) => _roll(context, s, value, options),
            AsyncValue(:final error?) => Column(
              children: [
                ErrorText(errorText(s, error)),
                OutlinedButton(
                  onPressed: () => ref.invalidate(rollProvider(arg)),
                  child: Text(s.retry),
                ),
              ],
            ),
            _ => const Center(child: CircularProgressIndicator()),
          }
        else if (options.isEmpty && !assignments.isLoading)
          EmptyLine(s.nothingYet),
      ],
    );
  }

  Widget _roll(BuildContext context, S s, Loaded<Json> loaded, List<MarkOption> options) {
    final roll = loaded.data;
    _fill(roll);
    final roster = asList(roll['roster']);
    final locked = roll['locked'] == true;
    final window = roll['window'] is Map ? asJson(roll['window']) : <String, Object?>{};
    // closed: locked by the coordinator, or outside the marking window (the website's rule)
    final closed = locked || window['open'] == false;
    final present = _marks.values.where((c) => c != 'A' && c != 'LV').length;
    final absent = _marks.values.where((c) => c == 'A').length;
    final counts = roll['counts'] is Map ? asJson(roll['counts']) : <String, Object?>{};
    int n(String k) => (counts[k] as num?)?.toInt() ?? 0;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (loaded.stale) ...[StaleLine(at: loaded.at), const SizedBox(height: Tokens.sp2)],
        if (locked) ...[Notice(text: s.locked), const SizedBox(height: Tokens.sp2)],
        // the day as saved: its counts and who marked it, or not marked yet
        Text(
          roll['id'] == null
              ? s.notMarkedYetDate
              : [
                  s.savedCountsLine(n('P'), n('A'), n('LV'), n('L')),
                  '${s.markedBy('${roll['markedBy'] ?? '—'}')}'
                      '${roll['source'] == 'rfid' ? ' (${s.rfidGate})' : ''}'
                      '${roll['markedLate'] == true ? ' (${s.markedLateWord})' : ''}',
                ].join(' · '),
          key: const Key('markSaved'),
          style: Theme.of(context).textTheme.bodySmall,
        ),
        // the marking window: its note, or its hours
        if (window['note'] != null) ...[
          const SizedBox(height: Tokens.sp2),
          Notice(key: const Key('markWindow'), text: '${window['note']}'),
        ] else if (window['from'] != null || window['to'] != null) ...[
          const SizedBox(height: Tokens.sp1),
          Text(
            s.markingOpen(window['from'] as String?, window['to'] as String?),
            key: const Key('markWindow'),
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ],
        const SizedBox(height: Tokens.sp2),
        Row(
          children: [
            Expanded(
              child: Text(
                s.presentAbsent(present, absent, roster.length),
                key: const Key('markCounts'),
              ),
            ),
            if (!closed)
              TextButton(
                key: const Key('allPresent'),
                onPressed: () => setState(() {
                  for (final r in roster) {
                    if (r['locked'] != true) _marks['${r['studentId']}'] = 'P';
                  }
                }),
                child: Text(s.allPresent),
              ),
          ],
        ),
        for (final r in roster) _row(s, r, closed),
        const SizedBox(height: Tokens.sp3),
        if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp2)],
        if (!closed && roster.isNotEmpty)
          FilledButton.icon(
            key: const Key('saveMarks'),
            icon: const Icon(Icons.check),
            label: Text(s.save),
            onPressed: _busy ? null : () => _save(roll, options),
          ),
        if (closed && roster.isNotEmpty)
          Text(
            locked ? s.registerLockedByCoordinator : s.markingClosed,
            key: const Key('markClosed'),
            style: Theme.of(context).textTheme.bodySmall,
          ),
      ],
    );
  }

  Widget _row(S s, Json r, bool sessionLocked) {
    final id = '${r['studentId']}';
    final code = _marks[id] ?? 'P';
    final onLeave = r['locked'] == true;
    final fixed = sessionLocked || onLeave;
    final hint = r['hint'] is Map ? asJson(r['hint']) : <String, Object?>{};
    final pass = hint['pass'] is Map ? asJson(hint['pass']) : null;
    final inAt = DateTime.tryParse('${r['inAt'] ?? ''}')?.toLocal();
    final remark = _remarks[id] ?? '';
    final details = [
      if (r['admissionNo'] != null) '${r['admissionNo']}',
      if (inAt != null)
        s.inAtWord(
          '${inAt.hour.toString().padLeft(2, '0')}:${inAt.minute.toString().padLeft(2, '0')}',
        ),
    ].join(' · ');
    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: Tokens.sp3, vertical: Tokens.sp2),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                SizedBox(
                  width: 32,
                  child: Text('${r['rollNo'] ?? ''}', style: Theme.of(context).textTheme.bodySmall),
                ),
                Expanded(child: Text('${r['name']}')),
                // large text: the word wraps rather than running off the card
                Flexible(child: StatusChip(s.attendanceCode(code), attendanceTone(code))),
              ],
            ),
            if (details.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(left: 32),
                child: Text(details, style: Theme.of(context).textTheme.bodySmall),
              ),
            if (onLeave) Text(s.onLeaveLocked, style: Theme.of(context).textTheme.bodySmall),
            if (!onLeave && hint['leave'] != null || pass != null)
              Padding(
                padding: const EdgeInsets.only(top: Tokens.sp1),
                child: Wrap(
                  spacing: Tokens.sp1,
                  runSpacing: Tokens.sp1,
                  children: [
                    if (!onLeave && hint['leave'] != null) StatusChip(s.onLeaveApproved, Tone.info),
                    if (pass != null)
                      StatusChip(
                        s.gatePass(pass['kind'] == 'early_leave', pass['atTime'] as String?),
                        Tone.warning,
                      ),
                  ],
                ),
              ),
            if (!fixed)
              Padding(
                padding: const EdgeInsets.only(top: Tokens.sp1),
                child: Wrap(
                  spacing: Tokens.sp1,
                  runSpacing: Tokens.sp1,
                  children: [
                    for (final c in _codes.take(3))
                      ChoiceChip(
                        key: Key('mark-$id-$c'),
                        label: Text(s.attendanceCode(c)),
                        selected: code == c,
                        onSelected: (_) => setState(() => _marks[id] = c),
                      ),
                    PopupMenuButton<String>(
                      tooltip: s.more,
                      icon: const Icon(Icons.more_horiz),
                      onSelected: (c) => setState(() => _marks[id] = c),
                      itemBuilder: (_) => [
                        for (final c in _codes.skip(3))
                          PopupMenuItem(value: c, child: Text(s.attendanceCode(c))),
                      ],
                    ),
                    if (!_remarkOpen.contains(id) && remark.isEmpty)
                      TextButton.icon(
                        key: Key('remark-$id'),
                        icon: const Icon(Icons.edit_note),
                        label: Text(s.addRemark),
                        onPressed: () => setState(() => _remarkOpen.add(id)),
                      ),
                  ],
                ),
              ),
            // the remark: a box when asked for or already there; read only when the register is closed
            if (!fixed && (_remarkOpen.contains(id) || remark.isNotEmpty))
              Padding(
                padding: const EdgeInsets.only(top: Tokens.sp2),
                child: TextFormField(
                  key: Key('remarkBox-$id'),
                  initialValue: remark,
                  maxLength: 200,
                  decoration: InputDecoration(
                    labelText: '${s.addRemark} · ${r['name']}',
                    border: const OutlineInputBorder(),
                    isDense: true,
                    counterText: '',
                  ),
                  onChanged: (v) => _remarks[id] = v,
                ),
              )
            else if (fixed && remark.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: Tokens.sp1),
                child: Text(
                  '${s.addRemark}: $remark',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ),
          ],
        ),
      ),
    );
  }
}
