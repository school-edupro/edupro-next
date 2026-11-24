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

/// The words of My day (as the staff website's, in English and Hindi).
extension ActivityWords on S {
  String _a(String en, String hi) => hindi ? hi : en;

  String get alHelp => _a(
    'Write what you did today: from, to, the kind of work and a line about it. Submitting is enough; your head sees it.',
    'आज आपने क्या किया लिखें: कब से, कब तक, काम का प्रकार और एक पंक्ति। जमा करना काफ़ी है; आपके प्रमुख देखेंगे।',
  );
  String alState(String? st) => switch (st) {
    'draft' => _a('Draft', 'मसौदा'),
    'submitted' => _a('Submitted', 'जमा'),
    'reviewed' => _a('Reviewed', 'देखा गया'),
    'returned' => _a('Sent back', 'लौटाया गया'),
    _ => _a('Not filled', 'नहीं भरा'),
  };
  String get alNotYet => _a('Not filled yet', 'अभी नहीं भरा');
  String get alLate => _a('(late)', '(देर से)');
  String get alOnLeave => _a('On leave', 'अवकाश पर');
  String get alHalfLeave => _a('Half day leave', 'आधे दिन का अवकाश');
  String alLogged(int m) => _a(
    '${m ~/ 60}h ${(m % 60).toString().padLeft(2, '0')}m logged',
    '${m ~/ 60} घं ${(m % 60).toString().padLeft(2, '0')} मि दर्ज',
  );
  String get alEdited => _a('edited after submission', 'जमा करने के बाद बदला गया');
  String alSentBack(String? by, String note) => _a(
    'Sent back${by != null ? ' by $by' : ''}: $note',
    'लौटाया गया${by != null ? ' ($by)' : ''}: $note',
  );
  String alRemark(String? by, String note) => _a(
    'Reviewer’s remark${by != null ? ' ($by)' : ''}: $note',
    'समीक्षक की टिप्पणी${by != null ? ' ($by)' : ''}: $note',
  );
  String get alFromTimetable => _a(
    'The first rows come from your timetable for this day. Correct them, remove what did not happen, and add the rest of your day.',
    'पहली पंक्तियाँ इस दिन की आपकी समय-सारणी से हैं। इन्हें ठीक करें, जो नहीं हुआ उसे हटाएँ, और बाकी दिन जोड़ें।',
  );
  String get alAnotherDate => _a('Another date', 'दूसरी तिथि');
  String get alLeave => _a('Leave', 'अवकाश');
  String get alDayIs => _a('This day is', 'यह दिन');
  String alDayKind(String k) => switch (k) {
    'full' => _a('Leave, full day', 'अवकाश, पूरा दिन'),
    'half' => _a('Leave, half day', 'अवकाश, आधा दिन'),
    _ => _a('A working day', 'कार्य दिवस'),
  };
  String get alLeaveKind => _a('Kind of leave', 'अवकाश का प्रकार');
  String get alReason => _a('Reason', 'कारण');
  String get alLeaveHelp => _a(
    'Choosing a full day of leave empties the rows below. For a half day, fill what you did in the other half.',
    'पूरे दिन का अवकाश चुनने पर नीचे की पंक्तियाँ खाली हो जाती हैं। आधे दिन के लिए, बाकी आधे में क्या किया भरें।',
  );
  String get alActivities => _a('Activities of the day', 'दिन की गतिविधियाँ');
  String alRow(int n) => _a('Row $n', 'पंक्ति $n');
  String get alFrom => _a('From', 'से');
  String get alTo => _a('To', 'तक');
  String get alCategory => _a('Category', 'श्रेणी');
  String get alWhat => _a('What was done', 'क्या किया');
  String get alAddRow => _a('Add a row', 'पंक्ति जोड़ें');
  String alRemoveRow(int n) => _a('Remove row $n', 'पंक्ति $n हटाएँ');
  String get alRemove => _a('Remove', 'हटाएँ');
  String get alNothing =>
      _a('Nothing was written for this day.', 'इस दिन के लिए कुछ नहीं लिखा गया।');
  String get alPending => _a('Pending / carried forward', 'बाकी / आगे ले जाया गया');
  String get alTomorrow => _a('Plan for tomorrow', 'कल की योजना');
  String alRules(String cutoff, int back) => _a(
    'A row needs its from, to, category and what was done; an empty row is ignored. Submit by $cutoff; later it is marked late. A draft can be changed any time; once submitted the day is locked unless it is sent back. A day can be filled up to $back day(s) later.',
    'हर पंक्ति में से, तक, श्रेणी और क्या किया चाहिए; खाली पंक्ति छोड़ दी जाती है। $cutoff तक जमा करें; बाद में देर से माना जाएगा। मसौदा कभी भी बदला जा सकता है; जमा करने पर दिन लॉक हो जाता है जब तक लौटाया न जाए। कोई दिन $back दिन बाद तक भरा जा सकता है।',
  );
  String get alSaveDraft => _a('Save draft', 'मसौदा सहेजें');
  String get alSubmit => _a('Submit my day', 'मेरा दिन जमा करें');
  String get alSaveChanges => _a('Save changes', 'बदलाव सहेजें');
  String get alLocked => _a(
    'This day is submitted and locked. It can be changed only if it is sent back to you.',
    'यह दिन जमा और लॉक है। इसे तभी बदला जा सकता है जब यह आपको लौटाया जाए।',
  );
  String get alClosed => _a(
    'This day can no longer be filled; ask the office if it must be reopened.',
    'यह दिन अब नहीं भरा जा सकता; दोबारा खुलवाना हो तो कार्यालय से कहें।',
  );
  String get alSubmitted => _a('Your day is submitted.', 'आपका दिन जमा हो गया।');
  String get alDrafted =>
      _a('Draft saved. Remember to submit it.', 'मसौदा सहेजा गया। इसे जमा करना याद रखें।');
  String alRowProblem(int n) => _a(
    'Row $n: fill from, to, category and what was done (or remove the row).',
    'पंक्ति $n: से, तक, श्रेणी और क्या किया भरें (या पंक्ति हटाएँ)।',
  );
  String get alNeedLeaveKind => _a('Choose the kind of leave.', 'अवकाश का प्रकार चुनें।');
  String get alDownload => _a('Download my log', 'मेरा लॉग डाउनलोड करें');
  String get alDownloadFrom => _a('From', 'से');
  String get alNotYours => _a(
    'The daily activity log is not part of your role.',
    'दैनिक गतिविधि लॉग आपकी भूमिका में नहीं है।',
  );
  String get alChoose => _a('Choose', 'चुनें');
}

/// The day's log: `(profile, date)` — empty date: today.
final activityDayProvider = FutureProvider.autoDispose.family<Json, (Profile, String)>((
  ref,
  k,
) async {
  final (_, date) = k;
  return asJson(await ref.read(apiProvider).activityLogMine(date: date.isEmpty ? null : date));
});

/// One row of the day, as the form edits it.
class _Row {
  _Row({this.from, this.to, this.categoryId, String description = '', this.source = 'manual'})
    : what = TextEditingController(text: description);
  String? from;
  String? to;
  String? categoryId;
  final TextEditingController what;
  final String source;
  bool get empty => from == null && to == null && what.text.trim().isEmpty;
}

/// My day as on the staff website: the last seven days and another date, the day's state, what was sent back or
/// remarked, leave, the rows (from, to, category, what was done — a new day starts from the timetable), what is
/// pending and tomorrow's plan, save a draft or submit; my log between two dates as Excel or PDF. No web page.
class ActivityLogScreen extends ConsumerStatefulWidget {
  const ActivityLogScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<ActivityLogScreen> createState() => _ActivityLogScreenState();
}

class _ActivityLogScreenState extends ConsumerState<ActivityLogScreen> {
  String _date = '';

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final value = ref.watch(activityDayProvider((widget.profile, _date)));
    if (value.error is ApiException) {
      final e = value.error as ApiException;
      if (e.status == 403 || e.status == 409) {
        return Padding(
          padding: const EdgeInsets.all(Tokens.sp4),
          child: Notice(text: e.status == 409 && e.detail.isNotEmpty ? e.detail : s.alNotYours),
        );
      }
    }
    return AsyncBody<Json>(
      value: value,
      retry: () => ref.invalidate(activityDayProvider((widget.profile, _date))),
      // a fresh form for each day read (its rows start from what the server has)
      data: (d) => _Day(
        key: ValueKey('${asJson(d['log'])['date']}-${asJson(d['log'])['id']}-${d.hashCode}'),
        profile: widget.profile,
        data: d,
        onDate: (x) => setState(() => _date = x),
        reload: () => ref.invalidate(activityDayProvider((widget.profile, _date))),
      ),
    );
  }
}

class _Day extends ConsumerStatefulWidget {
  const _Day({
    super.key,
    required this.profile,
    required this.data,
    required this.onDate,
    required this.reload,
  });
  final Profile profile;
  final Json data;
  final ValueChanged<String> onDate;
  final VoidCallback reload;

  @override
  ConsumerState<_Day> createState() => _DayState();
}

class _DayState extends ConsumerState<_Day> {
  late final Json _log = asJson(widget.data['log']);
  late final List<_Row> _rows = [
    for (final e
        in (asList(_log['entries']).isNotEmpty
            ? asList(_log['entries'])
            : asList(widget.data['suggested'])))
      _Row(
        from: e['from'] as String?,
        to: e['to'] as String?,
        categoryId: e['categoryId'] as String?,
        description: '${e['description'] ?? ''}',
        source: '${e['source'] ?? 'manual'}',
      ),
    if (widget.data['editable'] == true) _Row(),
  ];
  late String _leaveKind = '${asJson(_log['leave'])['kind'] ?? ''}';
  late String? _leaveType = asJson(_log['leave'])['type'] as String?;
  late final _leaveReason = TextEditingController(text: '${asJson(_log['leave'])['reason'] ?? ''}');
  late final _pending = TextEditingController(text: '${_log['pendingNote'] ?? ''}');
  late final _tomorrow = TextEditingController(text: '${_log['tomorrowPlan'] ?? ''}');
  late String _from = DateTime.parse('${_log['date']}')
      .subtract(const Duration(days: 6))
      .toIso8601String()
      .substring(0, 10);
  late String _to = '${_log['date']}';
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    for (final r in _rows) {
      r.what.dispose();
    }
    _leaveReason.dispose();
    _pending.dispose();
    _tomorrow.dispose();
    super.dispose();
  }

  String _hm(TimeOfDay t) =>
      '${t.hour.toString().padLeft(2, '0')}:${t.minute.toString().padLeft(2, '0')}';

  TimeOfDay? _tod(String? v) {
    if (v == null || v.length < 5) return null;
    return TimeOfDay(hour: int.parse(v.substring(0, 2)), minute: int.parse(v.substring(3, 5)));
  }

  Future<void> _save(bool submit) async {
    final s = ref.read(stringsProvider);
    String? problem;
    final entries = <SaveLogDtoEntriesItem>[];
    for (final (i, r) in _rows.indexed) {
      if (r.empty) continue;
      if (r.from == null || r.to == null || r.categoryId == null || r.what.text.trim().isEmpty) {
        problem ??= s.alRowProblem(i + 1);
      } else {
        entries.add(
          SaveLogDtoEntriesItem(
            from: r.from!,
            to: r.to!,
            categoryId: r.categoryId!,
            description: r.what.text.trim(),
            source: r.source,
          ),
        );
      }
    }
    final onLeave = _leaveKind == 'full' || _leaveKind == 'half';
    if (onLeave && (_leaveType == null || _leaveType!.isEmpty)) problem ??= s.alNeedLeaveKind;
    if (problem != null) return setState(() => _error = problem);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .activityLogSave(
            body: SaveLogDto(
              date: '${_log['date']}',
              entries: entries,
              tomorrowPlan: _tomorrow.text.trim().isEmpty ? null : _tomorrow.text.trim(),
              pendingNote: _pending.text.trim().isEmpty ? null : _pending.text.trim(),
              leave: onLeave
                  ? SaveLogDtoLeave(
                      kind: _leaveKind,
                      type: _leaveType!,
                      reason: _leaveReason.text.trim().isEmpty ? null : _leaveReason.text.trim(),
                    )
                  : null,
              submit: submit,
            ),
          );
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(submit ? s.alSubmitted : s.alDrafted)));
      widget.reload();
    } catch (e) {
      if (mounted) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<String?> _pickTime(String? now) async {
    final t = await showTimePicker(
      context: context,
      initialTime: _tod(now) ?? const TimeOfDay(hour: 9, minute: 0),
    );
    return t == null ? null : _hm(t);
  }

  Future<String?> _pickDate(String now) async {
    final today = schoolToday();
    final d = await showDatePicker(
      context: context,
      initialDate: DateTime.tryParse(now) ?? today,
      firstDate: today.subtract(const Duration(days: 365)),
      lastDate: today,
    );
    return d == null ? null : ymd(d);
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final d = widget.data;
    final editable = d['editable'] == true;
    final state = _log['state'] as String?;
    final submitted = state == 'submitted';
    final cats = asList(d['categories']);
    final leave = asJson(_log['leave']);
    final date = '${_log['date']}';
    final api = ref.read(apiProvider);
    InputDecoration box(String label) =>
        InputDecoration(labelText: label, border: const OutlineInputBorder(), counterText: '');
    return ListView(
      key: const Key('alDay'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        Text(s.alHelp, style: TextStyle(color: muted)),
        const SizedBox(height: Tokens.sp3),
        // the last seven days, as the website's links
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          children: [
            for (final r in asList(d['recent']))
              ChoiceChip(
                key: Key('alRecent-${r['date']}'),
                label: Text(
                  '${s.dayShort(DateTime.parse('${r['date']}'))} · ${s.alState(r['state'] as String?)}${r['late'] == true ? ' ${s.alLate}' : ''}',
                ),
                selected: r['date'] == date,
                onSelected: (_) => widget.onDate('${r['date']}'),
              ),
          ],
        ),
        const SizedBox(height: Tokens.sp2),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: OutlinedButton.icon(
            key: const Key('alAnother'),
            icon: const Icon(Icons.event),
            label: Text(s.alAnotherDate),
            onPressed: () async {
              final x = await _pickDate(date);
              if (x != null) widget.onDate(x);
            },
          ),
        ),
        const SizedBox(height: Tokens.sp3),
        Text(
          [
            s.date(date),
            state != null ? s.alState(state) : s.alNotYet,
            if (_log['late'] == true) s.alLate,
            if (leave.isNotEmpty)
              '${leave['kind'] == 'full' ? s.alOnLeave : s.alHalfLeave} (${leave['type']})',
            if ((_log['minutes'] as num? ?? 0) > 0) s.alLogged((_log['minutes'] as num).toInt()),
            if (_log['editedAt'] != null) s.alEdited,
          ].join(' · '),
          key: const Key('alState'),
          style: const TextStyle(fontWeight: Tokens.fwSemibold),
        ),
        if (state == 'returned' && _log['reviewNote'] != null) ...[
          const SizedBox(height: Tokens.sp2),
          Notice(text: s.alSentBack(_log['reviewedBy'] as String?, '${_log['reviewNote']}')),
        ],
        if (state == 'reviewed' && _log['reviewNote'] != null) ...[
          const SizedBox(height: Tokens.sp2),
          Text(
            s.alRemark(_log['reviewedBy'] as String?, '${_log['reviewNote']}'),
            style: TextStyle(color: muted),
          ),
        ],
        if (asList(_log['entries']).isEmpty && asList(d['suggested']).isNotEmpty && editable) ...[
          const SizedBox(height: Tokens.sp2),
          Text(s.alFromTimetable, style: TextStyle(color: muted, fontSize: 13)),
        ],
        if (editable) ...[
          SectionTitle(s.alLeave),
          DropdownMenu<String>(
            key: const Key('alDayKind'),
            label: Text(s.alDayIs),
            trailingIcon: dropArrow(s.alDayIs),
            selectedTrailingIcon: dropArrow(s.alDayIs, open: true),
            expandedInsets: EdgeInsets.zero,
            enableFilter: true,
            enableSearch: true,
            requestFocusOnTap: true,
            initialSelection: _leaveKind,
            onSelected: (v) => setState(() {
              _leaveKind = v ?? '';
              // a full day of leave has no rows
              if (_leaveKind == 'full') {
                for (final r in _rows) {
                  r.what.dispose();
                }
                _rows
                  ..clear()
                  ..add(_Row());
              }
            }),
            dropdownMenuEntries: [
              for (final k in const ['', 'full', 'half'])
                DropdownMenuEntry(value: k, label: s.alDayKind(k)),
            ],
          ),
          if (_leaveKind == 'full' || _leaveKind == 'half') ...[
            const SizedBox(height: Tokens.sp3),
            DropdownMenu<String>(
              key: const Key('alLeaveType'),
              label: Text(s.alLeaveKind),
              trailingIcon: dropArrow(s.alLeaveKind),
              selectedTrailingIcon: dropArrow(s.alLeaveKind, open: true),
              expandedInsets: EdgeInsets.zero,
              enableFilter: true,
              enableSearch: true,
              requestFocusOnTap: true,
              initialSelection: _leaveType,
              onSelected: (v) => setState(() => _leaveType = v),
              dropdownMenuEntries: [
                for (final t
                    in asList(d['leaveTypes']).isEmpty
                        ? const <Object>[]
                        : (d['leaveTypes'] as List))
                  DropdownMenuEntry(value: '$t', label: '$t'),
              ],
            ),
            const SizedBox(height: Tokens.sp3),
            TextField(
              key: const Key('alLeaveReason'),
              controller: _leaveReason,
              maxLength: 300,
              decoration: box(s.alReason),
            ),
          ],
          const SizedBox(height: Tokens.sp1),
          Text(s.alLeaveHelp, style: TextStyle(color: muted, fontSize: 13)),
        ],
        SectionTitle(s.alActivities),
        if (_rows.where((r) => !r.empty).isEmpty && !editable) Text(s.alNothing),
        for (final (i, r) in _rows.indexed)
          if (editable)
            Card(
              key: ObjectKey(r),
              margin: const EdgeInsets.only(bottom: Tokens.sp2),
              child: Padding(
                padding: const EdgeInsets.all(Tokens.sp3),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(s.alRow(i + 1), style: const TextStyle(fontWeight: Tokens.fwSemibold)),
                    const SizedBox(height: Tokens.sp2),
                    Wrap(
                      spacing: Tokens.sp2,
                      runSpacing: Tokens.sp2,
                      children: [
                        for (final (key, label, value, set) in [
                          (Key('alFrom-$i'), s.alFrom, r.from, (String v) => r.from = v),
                          (Key('alTo-$i'), s.alTo, r.to, (String v) => r.to = v),
                        ])
                          OutlinedButton.icon(
                            key: key,
                            icon: const Icon(Icons.schedule),
                            label: Text('$label: ${value ?? s.alChoose}'),
                            onPressed: () async {
                              final t = await _pickTime(value);
                              if (t != null) setState(() => set(t));
                            },
                          ),
                      ],
                    ),
                    const SizedBox(height: Tokens.sp3),
                    DropdownMenu<String>(
                      key: Key('alCat-$i'),
                      label: Text(s.alCategory),
                      trailingIcon: dropArrow(s.alCategory),
                      selectedTrailingIcon: dropArrow(s.alCategory, open: true),
                      expandedInsets: EdgeInsets.zero,
                      enableFilter: true,
                      enableSearch: true,
                      requestFocusOnTap: true,
                      initialSelection: r.categoryId,
                      onSelected: (v) => setState(() => r.categoryId = v),
                      dropdownMenuEntries: [
                        for (final c in cats)
                          DropdownMenuEntry(value: '${c['id']}', label: '${c['name']}'),
                      ],
                    ),
                    const SizedBox(height: Tokens.sp3),
                    TextField(
                      key: Key('alWhat-$i'),
                      controller: r.what,
                      maxLength: 1000,
                      maxLines: 2,
                      minLines: 1,
                      decoration: box(s.alWhat),
                    ),
                    Align(
                      alignment: AlignmentDirectional.centerEnd,
                      child: TextButton.icon(
                        key: Key('alRemove-$i'),
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () => setState(() => _rows.removeAt(i).what.dispose()),
                        label: Semantics(
                          label: s.alRemoveRow(i + 1),
                          excludeSemantics: true,
                          child: Text(s.alRemove),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            )
          else if (!r.empty)
            Padding(
              padding: const EdgeInsets.only(bottom: Tokens.sp2),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${r.from ?? ''} – ${r.to ?? ''} · ${cats.firstWhere((c) => '${c['id']}' == r.categoryId, orElse: () => const {})['name'] ?? ''}',
                    style: const TextStyle(fontWeight: Tokens.fwSemibold),
                  ),
                  Text(r.what.text),
                ],
              ),
            ),
        if (editable && _rows.length < 40)
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: OutlinedButton.icon(
              key: const Key('alAddRow'),
              icon: const Icon(Icons.add),
              label: Text(s.alAddRow),
              onPressed: () => setState(() => _rows.add(_Row())),
            ),
          ),
        if (editable) ...[
          const SizedBox(height: Tokens.sp3),
          TextField(
            key: const Key('alPending'),
            controller: _pending,
            maxLength: 2000,
            maxLines: 3,
            minLines: 2,
            decoration: box(s.alPending),
          ),
          const SizedBox(height: Tokens.sp3),
          TextField(
            key: const Key('alTomorrow'),
            controller: _tomorrow,
            maxLength: 2000,
            maxLines: 3,
            minLines: 2,
            decoration: box(s.alTomorrow),
          ),
          const SizedBox(height: Tokens.sp2),
          Text(
            s.alRules('${d['cutoffTime'] ?? ''}', (d['backDays'] as num? ?? 0).toInt()),
            style: TextStyle(color: muted, fontSize: 13),
          ),
          if (_error != null) ...[const SizedBox(height: Tokens.sp2), ErrorText(_error!)],
          const SizedBox(height: Tokens.sp3),
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp2,
            children: [
              if (!submitted)
                OutlinedButton(
                  key: const Key('alDraft'),
                  onPressed: _busy ? null : () => _save(false),
                  child: Text(s.alSaveDraft),
                ),
              FilledButton(
                key: const Key('alSubmit'),
                onPressed: _busy ? null : () => _save(true),
                child: Text(submitted ? s.alSaveChanges : s.alSubmit),
              ),
            ],
          ),
        ] else ...[
          if (_log['pendingNote'] != null) Text('${s.alPending}: ${_log['pendingNote']}'),
          if (_log['tomorrowPlan'] != null) Text('${s.alTomorrow}: ${_log['tomorrowPlan']}'),
          const SizedBox(height: Tokens.sp2),
          Notice(text: state == 'submitted' || state == 'reviewed' ? s.alLocked : s.alClosed),
        ],
        SectionTitle(s.alDownload),
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            for (final (key, label, value, set) in [
              (const Key('alRepFrom'), s.alDownloadFrom, _from, (String v) => _from = v),
              (const Key('alRepTo'), s.alTo, _to, (String v) => _to = v),
            ])
              OutlinedButton.icon(
                key: key,
                icon: const Icon(Icons.event),
                label: Text('$label: ${s.date(value)}'),
                onPressed: () async {
                  final x = await _pickDate(value);
                  if (x != null) setState(() => set(x));
                },
              ),
            for (final (format, label) in const [('xlsx', 'Excel'), ('pdf', 'PDF')])
              TextButton.icon(
                key: Key('alRep-$format'),
                icon: Icon(format == 'pdf' ? Icons.picture_as_pdf_outlined : Icons.grid_on),
                label: Text(label),
                onPressed: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) => FileScreen(
                      title: s.alDownload,
                      load: () =>
                          api.activityLogMyReport(from: _from, to: _to, format: format, wrap: '1'),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }
}
