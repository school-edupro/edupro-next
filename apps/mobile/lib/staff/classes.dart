import 'package:file_picker/file_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart' show ImagePicker, ImageSource;
import 'package:material_ui/material_ui.dart';
import 'package:uuid/uuid.dart';

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
import 'marks.dart';

/// A staff member's Classes tab: post homework, enter marks, the week's timetable, payslips.
class ClassesTab extends ConsumerWidget {
  const ClassesTab({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final items = <(String, IconData, Widget)>[
      (s.postWork, Icons.menu_book_outlined, PostWorkScreen(profile: profile)),
      (s.marksEntry, Icons.edit_note, MarksHome(profile: profile)),
      (s.myTimetable, Icons.view_week_outlined, StaffTimetable(profile: profile)),
      (s.payslips, Icons.receipt_long_outlined, PayslipsScreen(profile: profile)),
    ];
    return ListView(
      key: const Key('classesTab'),
      children: [
        for (final (title, icon, screen) in items)
          ListTile(
            leading: Icon(icon),
            title: Text(title),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => pushPage(context, title, screen),
          ),
      ],
    );
  }
}

/// Homework, classwork or an assignment for one class: what to do, the due date, photos or files.
class PostWorkScreen extends ConsumerStatefulWidget {
  const PostWorkScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<PostWorkScreen> createState() => _PostWorkScreenState();
}

class _PostWorkScreenState extends ConsumerState<PostWorkScreen> {
  String? _section;
  String? _subject;
  String _kind = 'homework';
  DateTime? _due;
  bool _ack = false;
  final _title = TextEditingController();
  final _body = TextEditingController();
  final List<PickedFile> _files = [];
  String? _error;
  bool _busy = false;
  // one key for this post: a resend after a lost answer gets the first answer, not a second post
  String _key = const Uuid().v4();

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _pickFile() async {
    final picked = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp'],
    );
    final f = picked.firstOrNull;
    if (f == null) return;
    final bytes = await f.readAsBytes();
    setState(
      () => _files.add(PickedFile(name: f.name, bytes: bytes, contentType: contentTypeOf(f.name))),
    );
  }

  Future<void> _photo() async {
    final x = await ImagePicker().pickImage(source: ImageSource.camera, imageQuality: 80);
    if (x == null) return;
    final bytes = await x.readAsBytes();
    setState(() => _files.add(PickedFile(name: x.name, bytes: bytes, contentType: 'image/jpeg')));
  }

  Future<void> _post() async {
    final s = ref.read(stringsProvider);
    if (_section == null) return setState(() => _error = s.chooseSection);
    if (_title.text.trim().isEmpty) return setState(() => _error = s.titleNeeded);
    setState(() {
      _busy = true;
      _error = null;
    });
    final api = ref.read(apiProvider);
    try {
      final ids = [for (final f in _files) await uploadFile(api, ref.read(transportProvider), f)];
      await withCall(
        CallOptions(idempotencyKey: _key),
        () => api.dailyWorkCreate(
          body: CreateDailyWorkDto(
            classSectionId: _section!,
            subjectId: _subject,
            kind: _kind,
            title: _title.text.trim(),
            body: _body.text.trim(),
            dueOn: _due == null ? null : ymd(_due!),
            fileIds: ids,
            ackRequired: _ack,
          ),
        ),
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.posted)));
      setState(() {
        _title.clear();
        _body.clear();
        _files.clear();
        _due = null;
        _key = const Uuid().v4();
      });
    } catch (e) {
      setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final opts = ref.watch(workOptionsProvider(widget.profile)).value?.data ?? const <Json>[];
    final subjects = asList(
      opts.where((o) => '${o['classSectionId']}' == _section).firstOrNull?['subjects'],
    );
    return ListView(
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        DropdownMenu<String>(
          key: const Key('workSection'),
          label: Text(s.section),
          trailingIcon: dropArrow(s.section),
          selectedTrailingIcon: dropArrow(s.section, open: true),
          expandedInsets: EdgeInsets.zero,
          enableFilter: true,
          enableSearch: true,
          requestFocusOnTap: true,
          onSelected: (v) => setState(() {
            _section = v;
            _subject = null;
          }),
          dropdownMenuEntries: [
            for (final o in opts)
              DropdownMenuEntry(value: '${o['classSectionId']}', label: '${o['section']}'),
          ],
        ),
        const SizedBox(height: Tokens.sp3),
        if (_section != null)
          DropdownMenu<String>(
            key: ValueKey('workSubject-$_section'),
            label: Text(s.subject),
            trailingIcon: dropArrow(s.subject),
            selectedTrailingIcon: dropArrow(s.subject, open: true),
            expandedInsets: EdgeInsets.zero,
            enableFilter: true,
            enableSearch: true,
            requestFocusOnTap: true,
            onSelected: (v) => setState(() => _subject = v == '' ? null : v),
            dropdownMenuEntries: [
              DropdownMenuEntry(value: '', label: s.noSubject),
              for (final x in subjects)
                DropdownMenuEntry(value: '${x['id']}', label: '${x['name']}'),
            ],
          ),
        const SizedBox(height: Tokens.sp3),
        SegmentedButton<String>(
          segments: [
            for (final k in ['homework', 'classwork', 'assignment'])
              ButtonSegment(value: k, label: Text(s.workKind(k))),
          ],
          selected: {_kind},
          onSelectionChanged: (v) => setState(() => _kind = v.first),
        ),
        const SizedBox(height: Tokens.sp3),
        TextField(
          key: const Key('workTitle'),
          controller: _title,
          maxLength: 160,
          decoration: InputDecoration(labelText: s.workTitle, border: const OutlineInputBorder()),
        ),
        TextField(
          key: const Key('workBody'),
          controller: _body,
          maxLines: 5,
          maxLength: 8000,
          decoration: InputDecoration(labelText: s.workBody, border: const OutlineInputBorder()),
        ),
        OutlinedButton.icon(
          key: const Key('workDue'),
          icon: const Icon(Icons.event),
          label: Text('${s.dueDate}: ${_due == null ? '—' : s.dayShort(_due!)}'),
          onPressed: () async {
            final today = schoolToday();
            final d = await showDatePicker(
              context: context,
              initialDate: _due ?? today.add(const Duration(days: 1)),
              firstDate: today,
              lastDate: today.add(const Duration(days: 180)),
            );
            if (d != null) setState(() => _due = d);
          },
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text(s.askAck),
          value: _ack,
          onChanged: (v) => setState(() => _ack = v),
        ),
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          children: [
            OutlinedButton.icon(
              icon: const Icon(Icons.photo_camera_outlined),
              label: Text(s.takePhoto),
              onPressed: _busy ? null : _photo,
            ),
            OutlinedButton.icon(
              icon: const Icon(Icons.attach_file),
              label: Text(s.addFile),
              onPressed: _busy ? null : _pickFile,
            ),
            for (var i = 0; i < _files.length; i++)
              InputChip(
                label: Text(s.attachmentN(i + 1)),
                onDeleted: () => setState(() => _files.removeAt(i)),
              ),
          ],
        ),
        const SizedBox(height: Tokens.sp3),
        if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp2)],
        FilledButton.icon(
          key: const Key('postWork'),
          icon: const Icon(Icons.send),
          label: Text(s.send),
          onPressed: _busy ? null : _post,
        ),
      ],
    );
  }
}

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
