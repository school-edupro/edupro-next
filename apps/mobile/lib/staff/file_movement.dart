import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/attendance.dart' show leaveFilePickerProvider;
import '../family/common.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/file_screen.dart';
import '../ui/widgets.dart';
import 'data.dart';
import 'office_parts.dart';

/// The words of File movement (as the staff website's and the admin's, in English and Hindi).
extension FileMovementWords on S {
  String _fm(String en, String hi) => hindi ? hi : en;

  String get fmTitle => _fm('File movement', 'फ़ाइल संचलन');
  String get fmIntro => _fm(
    'Files raised for approval move through the approvers their creator chose, level by level. An approved file can be downloaded as a PDF note sheet.',
    'स्वीकृति हेतु भेजी गई फ़ाइलें बनाने वाले द्वारा चुने गए अनुमोदकों के पास स्तर दर स्तर जाती हैं। स्वीकृत फ़ाइल PDF नोट शीट के रूप में डाउनलोड हो सकती है।',
  );
  String fmBox(String b, int n, int returned, bool seesAll) => switch (b) {
    'inbox' => _fm('To approve · $n', 'स्वीकृत करनी हैं · $n'),
    'mine' =>
      returned > 0
          ? _fm('My files · $returned sent back', 'मेरी फ़ाइलें · $returned वापस भेजी गईं')
          : _fm('My files', 'मेरी फ़ाइलें'),
    'acted' => _fm('Decided by me', 'मेरे द्वारा निर्णय'),
    _ => seesAll ? _fm('All', 'सभी') : _fm('All mine', 'मेरी सभी'),
  };
  String get fmAdd => _fm('Add new approval', 'नई स्वीकृति जोड़ें');
  String get fmDashboard => _fm('Dashboard', 'डैशबोर्ड');
  String fmFilters(int n) => n == 0 ? _fm('Filters', 'छाँटें') : _fm('Filters ($n)', 'छाँटें ($n)');
  String get fmStatus => _fm('Status', 'स्थिति');
  String get fmAnyStatus => _fm('Any status', 'कोई भी स्थिति');
  String fmStatusWord(String st) => switch (st) {
    'pending' => _fm('In approval', 'स्वीकृति में'),
    'returned' => _fm('Sent back', 'वापस भेजी गई'),
    'approved' => _fm('Approved', 'स्वीकृत'),
    'rejected' => _fm('Rejected', 'अस्वीकृत'),
    _ => _fm('Withdrawn', 'वापस ली गई'),
  };
  String get fmFrom => _fm('Raised from', 'भेजी गई (से)');
  String get fmTo => _fm('Raised to', 'भेजी गई (तक)');
  String get fmSearch => _fm('Subject, file no. or raised by', 'विषय, फ़ाइल संख्या या भेजने वाला');
  String get fmShow => _fm('Show', 'दिखाएँ');
  String get fmClear => _fm('Clear', 'साफ़ करें');
  String get fmPickDate => _fm('Pick a date', 'तिथि चुनें');
  String get fmNoneToApprove =>
      _fm('No file waits for your approval.', 'कोई फ़ाइल आपकी स्वीकृति की प्रतीक्षा में नहीं है।');
  String get fmNothing => _fm('Nothing here.', 'यहाँ कुछ नहीं है।');
  String fmRound(int n) => _fm('Round $n', 'दौर $n');
  String fmLevels(int done, int of) => _fm('$done of $of levels', '$of में से $done स्तर');
  String fmWith(String who) => _fm('With $who', 'प्रतीक्षा में: $who');
  String get fmExcelTitle => _fm('File movement (Excel)', 'फ़ाइल संचलन (Excel)');
  String get fmPdfTitle => _fm('File movement (PDF)', 'फ़ाइल संचलन (PDF)');

  // one file
  String fmRaisedBy(String who, String when) =>
      _fm('Raised by $who on $when', '$who द्वारा $when को भेजी गई');
  String get fmNoteSheet => _fm('Note sheet (PDF)', 'नोट शीट (PDF)');
  String fmSentBackBy(String who, String remark) =>
      _fm('This file was sent back by $who: “$remark”', 'यह फ़ाइल $who ने वापस भेजी: “$remark”');
  String get fmSentBack => _fm('This file was sent back.', 'यह फ़ाइल वापस भेजी गई।');
  String get fmCorrectHelp => _fm(
    'Correct it and submit again; it will start from the L1 approver.',
    'इसे सुधारकर फिर भेजें; यह L1 अनुमोदक से शुरू होगी।',
  );
  String get fmCorrect => _fm('Correct and submit again', 'सुधारें और फिर भेजें');
  String get fmMessage => _fm('Approval message', 'स्वीकृति संदेश');
  String get fmAttachments => _fm('Attachments', 'संलग्नक');
  String fmAttachment(int n) => _fm('Attachment $n', 'संलग्नक $n');
  String get fmNoneAttached => _fm('None attached.', 'कुछ संलग्न नहीं।');
  String get fmApprovers => _fm('Approvers', 'अनुमोदक');
  String fmLevelWord(String st) => switch (st) {
    'waiting' => _fm('Next', 'अगला'),
    'pending' => _fm('With this approver', 'इस अनुमोदक के पास'),
    'approved' => _fm('Approved', 'स्वीकृत'),
    'returned' => _fm('Sent back', 'वापस भेजी गई'),
    'rejected' => _fm('Rejected', 'अस्वीकृत'),
    _ => _fm('Not reached', 'नहीं पहुँचा'),
  };
  String get fmRemark => _fm(
    'Remark (needed to send back or reject; optional when approving)',
    'टिप्पणी (वापस भेजने या अस्वीकार करने हेतु आवश्यक; स्वीकृति में वैकल्पिक)',
  );
  String get fmApprove => _fm('Approve', 'स्वीकृत करें');
  String get fmSendBack => _fm('Send back to the creator', 'बनाने वाले को वापस भेजें');
  String get fmReject => _fm('Reject', 'अस्वीकार करें');
  String get fmNeedRemark => _fm(
    'Write a remark to send back or reject.',
    'वापस भेजने या अस्वीकार करने हेतु टिप्पणी लिखें।',
  );
  String get fmWithdraw => _fm('Withdraw this file', 'यह फ़ाइल वापस लें');
  String get fmWithdrawAsk => _fm(
    'Withdraw this file? Its approvals stop.',
    'यह फ़ाइल वापस लें? इसकी स्वीकृतियाँ रुक जाएँगी।',
  );
  String get fmKeep => _fm('Keep it', 'रहने दें');
  String get fmHistory => _fm('History', 'इतिहास');
  String fmAction(String a) => switch (a) {
    'submitted' => _fm('Submitted', 'भेजी गई'),
    'resubmitted' => _fm('Corrected and submitted again', 'सुधारकर फिर भेजी गई'),
    'approved' => _fm('Approved', 'स्वीकृत'),
    'returned' => _fm('Sent back', 'वापस भेजी गई'),
    'rejected' => _fm('Rejected', 'अस्वीकृत'),
    'withdrawn' => _fm('Withdrawn by the creator', 'बनाने वाले ने वापस ली'),
    _ => a,
  };
  String fmDone(String ok) => switch (ok) {
    'submitted' => _fm(
      'The file is submitted. It is with the L1 approver now.',
      'फ़ाइल भेज दी गई। अब यह L1 अनुमोदक के पास है।',
    ),
    'resubmitted' => _fm(
      'Submitted again. It starts from the L1 approver.',
      'फिर से भेजी गई। यह L1 अनुमोदक से शुरू होती है।',
    ),
    'approved' => _fm('Approved at your level.', 'आपके स्तर पर स्वीकृत।'),
    'returned' => _fm(
      'Sent back to the creator with your remark.',
      'आपकी टिप्पणी के साथ बनाने वाले को वापस भेजी गई।',
    ),
    'rejected' => _fm(
      'Rejected. The creator sees your remark.',
      'अस्वीकृत। बनाने वाला आपकी टिप्पणी देखता है।',
    ),
    _ => _fm('The file is withdrawn.', 'फ़ाइल वापस ले ली गई।'),
  };

  // raise / correct
  String get fmFormHelp => _fm(
    'Write what needs approval, attach the papers and choose who approves, in order.',
    'लिखें कि किसकी स्वीकृति चाहिए, काग़ज़ जोड़ें और क्रम से अनुमोदक चुनें।',
  );
  String get fmSubject => _fm('Approval subject', 'स्वीकृति का विषय');
  String get fmBody => _fm('Approval message', 'स्वीकृति संदेश');
  String get fmBodyHint =>
      _fm('Enter your approval message here…', 'अपना स्वीकृति संदेश यहाँ लिखें…');
  String fmAttachCount(int n) =>
      _fm('Attachments (maximum 4 files) · $n/4', 'संलग्नक (अधिकतम 4 फ़ाइलें) · $n/4');
  String fmKept(int n) =>
      _fm('Attachment $n (already on the file)', 'संलग्नक $n (फ़ाइल पर पहले से)');
  String get fmAddAttachment => _fm('Add attachment', 'संलग्नक जोड़ें');
  String get fmAttachHelp => _fm('PDF or photo, up to 5 MB each.', 'PDF या फ़ोटो, हर एक 5 MB तक।');
  String get fmAttachWrong => _fm(
    'Attach a PDF or a photo (PNG, JPEG, WebP) up to 5 MB.',
    'PDF या फ़ोटो (PNG, JPEG, WebP), 5 MB तक जोड़ें।',
  );
  String get fmRemove => _fm('Remove', 'हटाएँ');
  String fmRemoveAttachment(int n) => _fm('Remove attachment $n', 'संलग्नक $n हटाएँ');
  String get fmApproversOrder =>
      _fm('Approvers, in the order they approve', 'अनुमोदक, स्वीकृति के क्रम में');
  String fmLevel(int n) => _fm('L$n approver', 'L$n अनुमोदक');
  String get fmPickApprover => _fm('Select the approver', 'अनुमोदक चुनें');
  String fmAddLevel(int n) => _fm('Add L$n approver', 'L$n अनुमोदक जोड़ें');
  String fmRemoveLevel(int n) => _fm('Remove level $n', 'स्तर $n हटाएँ');
  String get fmLevelsHelp => _fm(
    'The file goes to L1 first; each level sees it after the one before approves.',
    'फ़ाइल पहले L1 को जाती है; हर स्तर पिछले की स्वीकृति के बाद देखता है।',
  );
  String get fmNeedSubject =>
      _fm('Write the subject (at least 3 letters).', 'विषय लिखें (कम से कम 3 अक्षर)।');
  String get fmNeedBody => _fm('Write the approval message.', 'स्वीकृति संदेश लिखें।');
  String get fmNeedL1 => _fm('Select the L1 approver.', 'L1 अनुमोदक चुनें।');
  String get fmNeedEvery => _fm(
    'Select an approver for every level added, or remove the level.',
    'जोड़े गए हर स्तर के लिए अनुमोदक चुनें, या स्तर हटाएँ।',
  );
  String get fmNeedDistinct => _fm(
    'The same person cannot approve at two levels.',
    'एक ही व्यक्ति दो स्तरों पर स्वीकृति नहीं दे सकता।',
  );
  String get fmSubmit => _fm('Submit approval', 'स्वीकृति हेतु भेजें');
  String get fmSubmitAgain => _fm('Submit again (from L1)', 'फिर भेजें (L1 से)');

  // dashboard
  String fmKpi(String k) => switch (k) {
    'total' => _fm('Files', 'फ़ाइलें'),
    'pending' => _fm('In approval', 'स्वीकृति में'),
    'returned' => _fm('Sent back', 'वापस भेजी गई'),
    'approved' => _fm('Approved', 'स्वीकृत'),
    _ => _fm('Rejected', 'अस्वीकृत'),
  };
  String get fmLastSix => _fm('Last six months', 'पिछले छह महीने');
  String fmMonthLine(int raised, int approved, int rejected) => _fm(
    '$raised raised · $approved approved · $rejected rejected',
    '$raised भेजी · $approved स्वीकृत · $rejected अस्वीकृत',
  );
  String get fmHolders => _fm('Who is holding files', 'किसके पास फ़ाइलें हैं');
  String get fmNoHolders =>
      _fm('No file is waiting with anyone.', 'कोई फ़ाइल किसी के पास प्रतीक्षा में नहीं है।');
  String fmHolder(int n, String since) => _fm('$n · oldest $since', '$n · सबसे पुरानी $since');
  String get fmOldest => _fm('Oldest files still in approval', 'स्वीकृति में सबसे पुरानी फ़ाइलें');
  String get fmNoOldest => _fm('Nothing is in approval.', 'स्वीकृति में कुछ नहीं है।');
  String fmSince(String who, String when) => _fm('$who · since $when', '$who · $when से');
}

const _boxes = ['inbox', 'mine', 'acted', 'all'];
const _statuses = ['pending', 'returned', 'approved', 'rejected', 'withdrawn'];
final _okAttach = RegExp(r'^(application/pdf|image/(png|jpeg|webp))$');

Tone _tone(String st) => switch (st) {
  'pending' => Tone.warning,
  'returned' => Tone.info,
  'approved' => Tone.success,
  'rejected' => Tone.danger,
  _ => Tone.neutral,
};

String _when(S s, Object? iso) {
  final d = DateTime.tryParse('$iso');
  return d == null ? '' : s.dateTime(d);
}

/// The list's filters: the box, the status, the dates and the words.
typedef FileQuery = ({String who, String box, String? status, String? from, String? to, String? q});

final fileListProvider = FutureProvider.autoDispose.family<Loaded<Json>, FileQuery>((ref, f) async {
  final r = await cached(
    'files:${f.who}:${f.box}:${f.status}:${f.from}:${f.to}:${f.q}',
    () => ref
        .read(apiProvider)
        .fileMovementList(box: f.box, status: f.status, from: f.from, to: f.to, q: f.q),
  );
  return Loaded(asJson(r.data), r.at, stale: r.stale);
});

final fileProvider = FutureProvider.autoDispose.family<Json, String>(
  (ref, id) async => asJson(await ref.read(apiProvider).fileMovementGet(id: id)),
);

/// The employees who can be chosen as approvers.
final filePeopleProvider = FutureProvider.autoDispose<List<Json>>(
  (ref) async => asList(asJson(await ref.read(apiProvider).fileMovementPeople())['data']),
);

final fileDashboardProvider = FutureProvider.autoDispose<Json>(
  (ref) async => asJson(await ref.read(apiProvider).fileMovementDashboard()),
);

/// Opens one file in full; [said]: a note to show as it opens.
void openFile(BuildContext context, Profile profile, String id, String title, {String? said}) =>
    pushPage(context, title, FileDetailScreen(profile: profile, id: id, said: said));

/// File movement as on the staff website and the admin's page: To approve, My files, Decided by me and All, the
/// filters (status, dates, words), Excel and PDF of the list, Add new approval and the Dashboard; each file in full.
class FilesScreen extends ConsumerStatefulWidget {
  const FilesScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<FilesScreen> createState() => _FilesScreenState();
}

class _FilesScreenState extends ConsumerState<FilesScreen> {
  String _box = 'inbox';
  String? _status;
  String? _from;
  String? _to;
  final _q = TextEditingController();
  String? _search;

  @override
  void dispose() {
    _q.dispose();
    super.dispose();
  }

  FileQuery get _query =>
      (who: widget.profile.id, box: _box, status: _status, from: _from, to: _to, q: _search);

  int get _filtersOn => [_status, _from, _to, _search].where((x) => x != null).length;

  Future<void> _add() async {
    final s = ref.read(stringsProvider);
    final r = await Navigator.of(context).push<({String id, String said})>(
      MaterialPageRoute(
        builder: (_) => FamilyPage(
          title: s.fmAdd,
          child: FileFormScreen(profile: widget.profile),
        ),
      ),
    );
    if (r == null || !mounted) return;
    ref.invalidate(fileListProvider);
    openFile(context, widget.profile, r.id, s.fmTitle, said: r.said);
  }

  Future<void> _pickDate(bool from) async {
    final now = DateTime.now();
    final cur = DateTime.tryParse((from ? _from : _to) ?? '');
    final d = await showDatePicker(
      context: context,
      initialDate: cur ?? now,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 1),
    );
    if (d != null) setState(() => from ? _from = ymd(d) : _to = ymd(d));
  }

  void _file(String format) {
    final s = ref.read(stringsProvider);
    final api = ref.read(apiProvider);
    final q = _query;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => FileScreen(
          title: format == 'pdf' ? s.fmPdfTitle : s.fmExcelTitle,
          load: () => api.fileMovementExport(
            box: q.box,
            status: q.status,
            from: q.from,
            to: q.to,
            q: q.q,
            format: format,
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final list = ref.watch(fileListProvider(_query));
    final d = list.value?.data ?? const <String, dynamic>{};
    final inbox = (d['inbox'] as num?)?.toInt() ?? 0;
    final returned = (d['returned'] as num?)?.toInt() ?? 0;
    final seesAll = d['seesAll'] == true;
    final at = _boxes.indexOf(_box);
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        key: const Key('fmAdd'),
        icon: const Icon(Icons.add),
        label: Text(s.fmAdd),
        onPressed: _add,
      ),
      body: Column(
        children: [
          Material(
            color: Theme.of(context).colorScheme.surface,
            child: DefaultTabController(
              length: _boxes.length,
              initialIndex: at,
              child: TabBar(
                key: const Key('fmTabs'),
                isScrollable: true,
                tabAlignment: TabAlignment.start,
                onTap: (i) => setState(() => _box = _boxes[i]),
                tabs: [for (final b in _boxes) Tab(text: s.fmBox(b, inbox, returned, seesAll))],
              ),
            ),
          ),
          Expanded(
            child: LoadedList<Json>(
              value: list,
              refresh: () => ref.refresh(fileListProvider(_query).future),
              children: (d) {
                final rows = asList(d['data']);
                final muted = officeMuted(context);
                return [
                  Text(s.fmIntro, style: TextStyle(color: muted, fontSize: 14)),
                  const SizedBox(height: Tokens.sp3),
                  Wrap(
                    spacing: Tokens.sp2,
                    runSpacing: Tokens.sp2,
                    children: [
                      OutlinedButton.icon(
                        key: const Key('fmDashboard'),
                        icon: const Icon(Icons.insights_outlined),
                        label: Text(s.fmDashboard),
                        onPressed: () => pushPage(
                          context,
                          s.fmDashboard,
                          FileDashboardScreen(profile: widget.profile),
                        ),
                      ),
                      OutlinedButton.icon(
                        key: const Key('fmExcel'),
                        icon: const Icon(Icons.table_view_outlined),
                        label: const Text('Excel'),
                        onPressed: () => _file('xlsx'),
                      ),
                      OutlinedButton.icon(
                        key: const Key('fmPdf'),
                        icon: const Icon(Icons.picture_as_pdf_outlined),
                        label: const Text('PDF'),
                        onPressed: () => _file('pdf'),
                      ),
                    ],
                  ),
                  const SizedBox(height: Tokens.sp2),
                  Card(
                    margin: EdgeInsets.zero,
                    child: ExpansionTile(
                      key: const Key('fmFilters'),
                      leading: const Icon(Icons.filter_list),
                      title: Text(s.fmFilters(_filtersOn)),
                      childrenPadding: const EdgeInsets.fromLTRB(
                        Tokens.sp3,
                        Tokens.sp2,
                        Tokens.sp3,
                        Tokens.sp3,
                      ),
                      children: [
                        DropdownMenu<String>(
                          key: const Key('fmStatus'),
                          label: Text(s.fmStatus),
                          trailingIcon: dropArrow(s.fmStatus),
                          selectedTrailingIcon: dropArrow(s.fmStatus, open: true),
                          expandedInsets: EdgeInsets.zero,
                          enableFilter: true,
                          enableSearch: true,
                          requestFocusOnTap: true,
                          initialSelection: _status ?? '',
                          onSelected: (v) =>
                              setState(() => _status = v == null || v.isEmpty ? null : v),
                          dropdownMenuEntries: [
                            DropdownMenuEntry(value: '', label: s.fmAnyStatus),
                            for (final st in _statuses)
                              DropdownMenuEntry(value: st, label: s.fmStatusWord(st)),
                          ],
                        ),
                        const SizedBox(height: Tokens.sp3),
                        OfficePickField(
                          key: const Key('fmFrom'),
                          label: s.fmFrom,
                          value: _from == null ? null : s.date(_from!),
                          hint: s.fmPickDate,
                          onTap: () => _pickDate(true),
                        ),
                        const SizedBox(height: Tokens.sp3),
                        OfficePickField(
                          key: const Key('fmTo'),
                          label: s.fmTo,
                          value: _to == null ? null : s.date(_to!),
                          hint: s.fmPickDate,
                          onTap: () => _pickDate(false),
                        ),
                        const SizedBox(height: Tokens.sp3),
                        TextField(
                          key: const Key('fmQ'),
                          controller: _q,
                          maxLength: 80,
                          textInputAction: TextInputAction.search,
                          onSubmitted: (_) => setState(
                            () => _search = _q.text.trim().isEmpty ? null : _q.text.trim(),
                          ),
                          decoration: InputDecoration(
                            labelText: s.fmSearch,
                            border: const OutlineInputBorder(),
                            counterText: '',
                          ),
                        ),
                        const SizedBox(height: Tokens.sp2),
                        Wrap(
                          spacing: Tokens.sp2,
                          children: [
                            FilledButton(
                              key: const Key('fmShow'),
                              onPressed: () => setState(
                                () => _search = _q.text.trim().isEmpty ? null : _q.text.trim(),
                              ),
                              child: Text(s.fmShow),
                            ),
                            OutlinedButton(
                              key: const Key('fmClear'),
                              onPressed: () => setState(() {
                                _status = null;
                                _from = null;
                                _to = null;
                                _q.clear();
                                _search = null;
                              }),
                              child: Text(s.fmClear),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: Tokens.sp3),
                  if (rows.isEmpty) Notice(text: _box == 'inbox' ? s.fmNoneToApprove : s.fmNothing),
                  for (final n in rows) _FileCard(profile: widget.profile, note: n),
                  // room for the floating Add button
                  const SizedBox(height: 88),
                ];
              },
            ),
          ),
        ],
      ),
    );
  }
}

/// A file on the list, as a row of the admin's table: the file no., subject (round), raised by and designation,
/// when, the levels approved, with whom it waits, and its status.
class _FileCard extends ConsumerWidget {
  const _FileCard({required this.profile, required this.note});
  final Profile profile;
  final Json note;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final n = note;
    final st = '${n['status']}';
    final muted = officeMuted(context);
    final round = (n['round'] as num?)?.toInt() ?? 1;
    final waiting = n['waitingOn'] ?? (st == 'returned' ? n['createdBy'] : null);
    return Card(
      key: Key('fmFile-${n['id']}'),
      margin: const EdgeInsets.only(bottom: Tokens.sp3),
      child: InkWell(
        onTap: () => openFile(context, profile, '${n['id']}', '${n['number']}'),
        child: Padding(
          padding: const EdgeInsets.all(Tokens.sp3),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      '${n['number']}',
                      style: TextStyle(
                        fontWeight: Tokens.fwBold,
                        color: Theme.of(context).colorScheme.primary,
                      ),
                    ),
                  ),
                  const SizedBox(width: Tokens.sp2),
                  StatusChip(s.fmStatusWord(st), _tone(st)),
                ],
              ),
              const SizedBox(height: Tokens.sp1),
              Text('${n['subject'] ?? ''}', style: const TextStyle(fontWeight: Tokens.fwSemibold)),
              if (round > 1) Text(s.fmRound(round), style: TextStyle(color: muted, fontSize: 13)),
              const SizedBox(height: Tokens.sp1),
              Text(
                [
                  '${n['createdBy'] ?? ''}${n['designation'] != null ? ' (${n['designation']})' : ''}',
                  _when(s, n['createdAt']),
                ].join(' · '),
                style: TextStyle(color: muted, fontSize: 13),
              ),
              Text(
                [
                  s.fmLevels(
                    (n['approvedLevels'] as num?)?.toInt() ?? 0,
                    (n['levels'] as num?)?.toInt() ?? 0,
                  ),
                  if (waiting != null) s.fmWith('$waiting'),
                ].join(' · '),
                style: TextStyle(color: muted, fontSize: 13),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One file as the admin's page: the subject, who raised it and when, its status and the note sheet PDF; sent back:
/// the remark and Correct and submit again; the message and attachments; the approvers level by level, the decision
/// (a remark, Approve / Send back / Reject) when it is with me; Withdraw for the creator; the whole history.
class FileDetailScreen extends ConsumerStatefulWidget {
  const FileDetailScreen({super.key, required this.profile, required this.id, this.said});
  final Profile profile;
  final String id;
  final String? said;

  @override
  ConsumerState<FileDetailScreen> createState() => _FileDetailScreenState();
}

class _FileDetailScreenState extends ConsumerState<FileDetailScreen> {
  final _messenger = GlobalKey<ScaffoldMessengerState>();
  final _remark = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final said = widget.said;
    if (said != null) WidgetsBinding.instance.addPostFrameCallback((_) => _say(said));
  }

  @override
  void dispose() {
    _remark.dispose();
    super.dispose();
  }

  void _say(String text) => _messenger.currentState
    ?..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(text)));

  void _reload() {
    ref.invalidate(fileProvider(widget.id));
    ref.invalidate(fileListProvider);
    ref.invalidate(approvalsProvider);
  }

  Future<void> _decide(String outcome) async {
    final s = ref.read(stringsProvider);
    final remark = _remark.text.trim();
    if (outcome != 'approved' && remark.isEmpty) return setState(() => _error = s.fmNeedRemark);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .fileMovementDecide(
            id: widget.id,
            body: FileDecideDto(outcome: outcome, remark: remark.isEmpty ? null : remark),
          );
      _remark.clear();
      _reload();
      _say(s.fmDone(outcome));
    } catch (e) {
      if (mounted) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _withdraw() async {
    final s = ref.read(stringsProvider);
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        content: Text(s.fmWithdrawAsk),
        actions: [
          TextButton(onPressed: () => Navigator.of(c).pop(false), child: Text(s.fmKeep)),
          FilledButton(
            key: const Key('fmWithdrawYes'),
            onPressed: () => Navigator.of(c).pop(true),
            child: Text(s.withdraw),
          ),
        ],
      ),
    );
    if (yes != true) return;
    try {
      await ref.read(apiProvider).fileMovementWithdraw(id: widget.id);
      _reload();
      _say(s.fmDone('withdrawn'));
    } catch (e) {
      _say(errorText(s, e));
    }
  }

  Future<void> _correct(Json f) async {
    final s = ref.read(stringsProvider);
    final r = await Navigator.of(context).push<({String id, String said})>(
      MaterialPageRoute(
        builder: (_) => FamilyPage(
          title: s.fmCorrect,
          child: FileFormScreen(profile: widget.profile, file: f),
        ),
      ),
    );
    if (r == null || !mounted) return;
    _reload();
    _say(r.said);
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final api = ref.read(apiProvider);
    return ScaffoldMessenger(
      key: _messenger,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: AsyncBody<Json>(
          value: ref.watch(fileProvider(widget.id)),
          retry: () => ref.invalidate(fileProvider(widget.id)),
          data: (f) {
            final muted = officeMuted(context);
            final st = '${f['status']}';
            final files = asList(f['files']);
            final levels = asList(f['levelsNow']);
            final history = asList(f['history']);
            final round = (f['round'] as num?)?.toInt() ?? 1;
            final lastBack = history.reversed.where((h) => h['action'] == 'returned').firstOrNull;
            return ListView(
              key: const Key('fmDetail'),
              padding: const EdgeInsets.all(Tokens.sp4),
              children: [
                Text('${s.fmTitle} · ${f['number']}', style: TextStyle(color: muted, fontSize: 14)),
                Text(
                  '${f['subject'] ?? ''}',
                  style: Theme.of(context).textTheme.titleLarge
                      ?.copyWith(fontWeight: Tokens.fwBold),
                ),
                Text(
                  '${s.fmRaisedBy('${f['createdBy'] ?? ''}${f['designation'] != null ? ' (${f['designation']})' : ''}', _when(s, f['createdAt']))}${round > 1 ? ' · ${s.fmRound(round)}' : ''}',
                  style: TextStyle(color: muted, fontSize: 13),
                ),
                const SizedBox(height: Tokens.sp2),
                Wrap(
                  spacing: Tokens.sp2,
                  runSpacing: Tokens.sp1,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    StatusChip(s.fmStatusWord(st), _tone(st)),
                    if (f['canDownload'] == true)
                      Wrap(
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Text(s.fmNoteSheet),
                          FileIcons(
                            label: s.fmNoteSheet,
                            name: 'fmPdf-${widget.id}',
                            load: () => api.fileMovementPdf(id: widget.id),
                          ),
                        ],
                      ),
                  ],
                ),
                if (f['canResubmit'] == true)
                  officeCard(context, s.fmCorrect, key: const Key('fmSentBack'), [
                    Text(
                      lastBack != null
                          ? s.fmSentBackBy('${lastBack['by']}', '${lastBack['remark'] ?? ''}')
                          : s.fmSentBack,
                    ),
                    Text(s.fmCorrectHelp, style: TextStyle(color: muted, fontSize: 13)),
                    const SizedBox(height: Tokens.sp2),
                    FilledButton(
                      key: const Key('fmCorrect'),
                      onPressed: () => _correct(f),
                      child: Text(s.fmCorrect),
                    ),
                  ]),
                officeCard(context, s.fmMessage, [
                  SelectionArea(child: Text(plainText('${f['bodyHtml'] ?? ''}'))),
                  const SizedBox(height: Tokens.sp3),
                  Text(s.fmAttachments, style: const TextStyle(fontWeight: Tokens.fwBold)),
                  if (files.isEmpty) Text(s.fmNoneAttached, style: TextStyle(color: muted)),
                  for (final (i, x) in files.indexed)
                    Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        Text(s.fmAttachment(i + 1)),
                        FileIcons(
                          label: s.fmAttachment(i + 1),
                          name: 'fmFile-${x['id']}',
                          load: () => api.fileMovementFile(id: widget.id, fileId: '${x['id']}'),
                        ),
                      ],
                    ),
                ]),
                officeCard(
                  context,
                  '${s.fmApprovers}${round > 1 ? ' · ${s.fmRound(round)}' : ''}',
                  key: const Key('fmLevels'),
                  [
                    for (final l in levels)
                      Container(
                        margin: const EdgeInsets.only(bottom: Tokens.sp2),
                        padding: const EdgeInsets.all(Tokens.sp3),
                        decoration: BoxDecoration(
                          border: Border.all(
                            color: l['status'] == 'pending'
                                ? Theme.of(context).colorScheme.primary
                                : Theme.of(context).dividerColor,
                            width: l['status'] == 'pending' ? 2 : 1,
                          ),
                          borderRadius: BorderRadius.circular(Tokens.radiusSm),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Wrap(
                              spacing: Tokens.sp2,
                              runSpacing: Tokens.sp1,
                              crossAxisAlignment: WrapCrossAlignment.center,
                              children: [
                                Text(
                                  'L${l['level']} · ${l['name']}',
                                  style: const TextStyle(fontWeight: Tokens.fwSemibold),
                                ),
                                StatusChip(
                                  s.fmLevelWord('${l['status']}'),
                                  switch ('${l['status']}') {
                                    'pending' => Tone.warning,
                                    'approved' => Tone.success,
                                    'returned' => Tone.info,
                                    'rejected' => Tone.danger,
                                    _ => Tone.neutral,
                                  },
                                ),
                              ],
                            ),
                            Text(
                              [
                                if (l['designation'] != null) '${l['designation']}',
                                if (l['actedAt'] != null) _when(s, l['actedAt']),
                              ].join(' · '),
                              style: TextStyle(color: muted, fontSize: 13),
                            ),
                            if (l['remark'] != null) Text('“${l['remark']}”'),
                          ],
                        ),
                      ),
                    if (f['canDecide'] == true) ...[
                      const SizedBox(height: Tokens.sp2),
                      TextField(
                        key: const Key('fmRemark'),
                        controller: _remark,
                        maxLength: 1000,
                        minLines: 2,
                        maxLines: 4,
                        decoration: InputDecoration(
                          labelText: s.fmRemark,
                          border: const OutlineInputBorder(),
                        ),
                      ),
                      if (_error != null) ErrorText(_error!),
                      Wrap(
                        spacing: Tokens.sp2,
                        runSpacing: Tokens.sp2,
                        children: [
                          FilledButton(
                            key: const Key('fmApprove'),
                            onPressed: _busy ? null : () => _decide('approved'),
                            child: Text(s.fmApprove),
                          ),
                          OutlinedButton(
                            key: const Key('fmReturn'),
                            onPressed: _busy ? null : () => _decide('returned'),
                            child: Text(s.fmSendBack),
                          ),
                          OutlinedButton(
                            key: const Key('fmReject'),
                            onPressed: _busy ? null : () => _decide('rejected'),
                            child: Text(s.fmReject),
                          ),
                        ],
                      ),
                    ],
                    if (f['canWithdraw'] == true)
                      Align(
                        alignment: AlignmentDirectional.centerStart,
                        child: TextButton(
                          key: const Key('fmWithdraw'),
                          onPressed: _withdraw,
                          child: Text(s.fmWithdraw),
                        ),
                      ),
                  ],
                ),
                if (history.isNotEmpty)
                  officeCard(context, s.fmHistory, key: const Key('fmHistory'), [
                    for (final h in history)
                      Padding(
                        padding: const EdgeInsets.only(bottom: Tokens.sp2),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              '${s.fmAction('${h['action']}')} · ${h['by'] ?? ''}',
                              style: const TextStyle(fontWeight: Tokens.fwSemibold),
                            ),
                            Text(
                              [
                                _when(s, h['at']),
                                s.fmRound((h['round'] as num?)?.toInt() ?? 1),
                                if (h['level'] != null) 'L${h['level']}',
                              ].join(' · '),
                              style: TextStyle(color: muted, fontSize: 13),
                            ),
                            if (h['remark'] != null) Text('${h['remark']}'),
                          ],
                        ),
                      ),
                  ]),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// The note as text, its paragraphs kept apart (a blank line between them).
String _text(String html) =>
    plainText(html.replaceAll(RegExp(r'</p>', caseSensitive: false), '</p>\n'));

/// The note as the website's editor keeps it: each paragraph of the text, escaped.
String _html(String text) => text
    .trim()
    .split(RegExp(r'\n\s*\n'))
    .where((p) => p.trim().isNotEmpty)
    .map(
      (p) =>
          '<p>${p.trim().replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br>')}</p>',
    )
    .join();

/// Raise a file, or (with [file]) correct one that was sent back, as the website's form: the subject, the message,
/// up to four attachments (those already on the file kept or removed) and the approvers in order, L1 needed and up to
/// L5. Pops with the file's id and what to say.
class FileFormScreen extends ConsumerStatefulWidget {
  const FileFormScreen({super.key, required this.profile, this.file});
  final Profile profile;
  final Json? file;

  @override
  ConsumerState<FileFormScreen> createState() => _FileFormScreenState();
}

class _FileFormScreenState extends ConsumerState<FileFormScreen> {
  late final _subject = TextEditingController(text: '${widget.file?['subject'] ?? ''}');
  late final _body = TextEditingController(
    text: widget.file == null ? '' : _text('${widget.file!['bodyHtml'] ?? ''}'),
  );
  late final List<Json> _onFile = asList(widget.file?['files']);
  late final Set<String> _kept = {for (final x in _onFile) '${x['id']}'};
  final List<PickedFile> _added = [];
  late List<String> _levels = widget.file == null
      ? ['']
      : [for (final l in asList(widget.file!['levelsNow'])) '${l['employeeId']}'];
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _subject.dispose();
    _body.dispose();
    super.dispose();
  }

  int get _count => _kept.length + _added.length;

  Future<void> _attach() async {
    final s = ref.read(stringsProvider);
    final picked = await ref.read(leaveFilePickerProvider)();
    if (picked.isEmpty) return;
    final ok = picked
        .where((f) => _okAttach.hasMatch(f.contentType) && f.bytes.length <= 5 * 1024 * 1024)
        .toList();
    setState(() {
      _error = ok.length < picked.length ? s.fmAttachWrong : null;
      _added.addAll(ok.take(4 - _count));
    });
  }

  String? _check(S s) {
    if (_subject.text.trim().length < 3) return s.fmNeedSubject;
    if (_body.text.trim().isEmpty) return s.fmNeedBody;
    if (_levels.first.isEmpty) return s.fmNeedL1;
    if (_levels.any((l) => l.isEmpty)) return s.fmNeedEvery;
    if (_levels.toSet().length != _levels.length) return s.fmNeedDistinct;
    return null;
  }

  Future<void> _submit() async {
    final s = ref.read(stringsProvider);
    final problem = _check(s);
    if (problem != null) return setState(() => _error = problem);
    setState(() {
      _busy = true;
      _error = null;
    });
    final api = ref.read(apiProvider);
    try {
      final ids = [
        ..._kept,
        for (final f in _added) await uploadFile(api, ref.read(transportProvider), f),
      ];
      final body = FileNoteDto(
        subject: _subject.text.trim(),
        bodyHtml: _html(_body.text),
        fileIds: ids,
        approverIds: _levels,
      );
      final old = widget.file == null ? null : '${widget.file!['id']}';
      final r = asJson(
        old == null
            ? await api.fileMovementCreate(body: body)
            : await api.fileMovementResubmit(id: old, body: body),
      );
      if (!mounted) return;
      Navigator.of(context).pop<({String id, String said})>((
        id: '${r['id'] ?? old}',
        said: s.fmDone(old == null ? 'submitted' : 'resubmitted'),
      ));
    } catch (e) {
      if (mounted) setState(() => _error = errorText(s, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    return AsyncBody<List<Json>>(
      value: ref.watch(filePeopleProvider),
      retry: () => ref.invalidate(filePeopleProvider),
      data: (people) {
        final muted = officeMuted(context);
        return ListView(
          key: const Key('fmForm'),
          padding: const EdgeInsets.all(Tokens.sp4),
          children: [
            Text(s.fmFormHelp, style: TextStyle(color: muted, fontSize: 14)),
            const SizedBox(height: Tokens.sp3),
            TextField(
              key: const Key('fmSubject'),
              controller: _subject,
              maxLength: 200,
              decoration: InputDecoration(
                labelText: '${s.fmSubject} *',
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: Tokens.sp2),
            TextField(
              key: const Key('fmBody'),
              controller: _body,
              minLines: 5,
              maxLines: 12,
              maxLength: 20000,
              decoration: InputDecoration(
                labelText: '${s.fmBody} *',
                hintText: s.fmBodyHint,
                alignLabelWithHint: true,
                border: const OutlineInputBorder(),
                counterText: '',
              ),
            ),
            officeCard(context, s.fmAttachCount(_count), [
              for (final (i, x) in _onFile.indexed)
                if (_kept.contains('${x['id']}'))
                  Wrap(
                    crossAxisAlignment: WrapCrossAlignment.center,
                    spacing: Tokens.sp2,
                    children: [
                      Text(s.fmKept(i + 1)),
                      TextButton(
                        key: Key('fmKeepOff-${x['id']}'),
                        onPressed: () => setState(() => _kept.remove('${x['id']}')),
                        child: Text(s.fmRemoveAttachment(i + 1)),
                      ),
                    ],
                  ),
              for (final (i, f) in _added.indexed)
                Wrap(
                  crossAxisAlignment: WrapCrossAlignment.center,
                  spacing: Tokens.sp2,
                  children: [
                    const Icon(Icons.attach_file, size: 18),
                    Text(f.name),
                    TextButton(
                      key: Key('fmAddedOff-$i'),
                      onPressed: () => setState(() => _added.removeAt(i)),
                      child: Text(s.fmRemove),
                    ),
                  ],
                ),
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: OutlinedButton.icon(
                  key: const Key('fmAttach'),
                  icon: const Icon(Icons.attach_file),
                  label: Text(s.fmAddAttachment),
                  onPressed: _count >= 4 ? null : _attach,
                ),
              ),
              Text(s.fmAttachHelp, style: TextStyle(color: muted, fontSize: 13)),
            ]),
            officeCard(context, s.fmApproversOrder, [
              for (var n = 0; n < _levels.length; n++)
                Padding(
                  key: ValueKey('fmLevel-$n-${_levels.length}'),
                  padding: const EdgeInsets.only(bottom: Tokens.sp3),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: DropdownMenu<String>(
                          key: Key('fmL${n + 1}'),
                          label: Text('${s.fmLevel(n + 1)}${n == 0 ? ' *' : ''}'),
                          trailingIcon: dropArrow(s.fmLevel(n + 1)),
                          selectedTrailingIcon: dropArrow(s.fmLevel(n + 1), open: true),
                          expandedInsets: EdgeInsets.zero,
                          enableFilter: true,
                          enableSearch: true,
                          requestFocusOnTap: true,
                          hintText: s.fmPickApprover,
                          initialSelection: _levels[n].isEmpty ? null : _levels[n],
                          onSelected: (v) => setState(() {
                            _levels = [
                              for (var i = 0; i < _levels.length; i++)
                                i == n ? (v ?? '') : _levels[i],
                            ];
                          }),
                          dropdownMenuEntries: [
                            for (final p in people)
                              if ('${p['id']}' == _levels[n] || !_levels.contains('${p['id']}'))
                                DropdownMenuEntry(value: '${p['id']}', label: '${p['name']}'),
                          ],
                        ),
                      ),
                      if (n > 0)
                        IconButton(
                          key: Key('fmLevelOff-${n + 1}'),
                          tooltip: s.fmRemoveLevel(n + 1),
                          icon: const Icon(Icons.close),
                          onPressed: () => setState(
                            () => _levels = [
                              for (var i = 0; i < _levels.length; i++)
                                if (i != n) _levels[i],
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: OutlinedButton.icon(
                  key: const Key('fmAddLevel'),
                  icon: const Icon(Icons.add),
                  label: Text(s.fmAddLevel((_levels.length + 1).clamp(1, 5))),
                  onPressed: _levels.length >= 5
                      ? null
                      : () => setState(() => _levels = [..._levels, '']),
                ),
              ),
              Text(s.fmLevelsHelp, style: TextStyle(color: muted, fontSize: 13)),
            ]),
            if (_error != null) ...[const SizedBox(height: Tokens.sp2), ErrorText(_error!)],
            const SizedBox(height: Tokens.sp3),
            FilledButton(
              key: const Key('fmSubmit'),
              onPressed: _busy ? null : _submit,
              child: Text(widget.file == null ? s.fmSubmit : s.fmSubmitAgain),
            ),
          ],
        );
      },
    );
  }
}

/// The dashboard as the admin's: the files by status, the last six months, who holds files, the oldest in approval.
class FileDashboardScreen extends ConsumerWidget {
  const FileDashboardScreen({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    return AsyncBody<Json>(
      value: ref.watch(fileDashboardProvider),
      retry: () => ref.invalidate(fileDashboardProvider),
      data: (d) {
        final muted = officeMuted(context);
        final c = asJson(d['counts']);
        final months = asList(d['months']);
        final holders = asList(d['holders']);
        final oldest = asList(d['oldest']);
        return ListView(
          key: const Key('fmDashboardScreen'),
          padding: const EdgeInsets.all(Tokens.sp4),
          children: [
            FigureGrid(
              key: const Key('fmFigures'),
              tiles: [
                for (final k in const ['total', 'pending', 'returned', 'approved', 'rejected'])
                  FigureTile(label: s.fmKpi(k), value: '${c[k] ?? 0}', icon: Icons.folder_outlined),
              ],
            ),
            officeCard(context, s.fmLastSix, [
              for (final m in months)
                FactLine(
                  DateTime.tryParse('${m['m']}-01') == null
                      ? '${m['m']}'
                      : s.month(DateTime.parse('${m['m']}-01')),
                  s.fmMonthLine(
                    (m['raised'] as num?)?.toInt() ?? 0,
                    (m['approved'] as num?)?.toInt() ?? 0,
                    (m['rejected'] as num?)?.toInt() ?? 0,
                  ),
                ),
            ]),
            officeCard(context, s.fmHolders, [
              if (holders.isEmpty) Text(s.fmNoHolders, style: TextStyle(color: muted)),
              for (final h in holders)
                FactLine(
                  '${h['name']}',
                  s.fmHolder((h['count'] as num?)?.toInt() ?? 0, _when(s, h['oldest'])),
                ),
            ]),
            officeCard(context, s.fmOldest, [
              if (oldest.isEmpty) Text(s.fmNoOldest, style: TextStyle(color: muted)),
              for (final n in oldest)
                ListTile(
                  key: Key('fmOld-${n['id']}'),
                  contentPadding: EdgeInsets.zero,
                  title: Text('${n['number']} · ${n['subject']}'),
                  subtitle: Text(s.fmSince('${n['createdBy'] ?? ''}', _when(s, n['submittedAt']))),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => openFile(context, profile, '${n['id']}', '${n['number']}'),
                ),
            ]),
          ],
        );
      },
    );
  }
}
