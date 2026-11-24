import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api_transport.dart';
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'common.dart';
import 'data.dart';

/// The library's words, in English and Hindi.
extension LibraryWords on S {
  String _lw(String en, String hi) => hindi ? hi : en;

  /// the screen's title (for the page band when it is wired in)
  String get libScreenTitle => _lw('Library', 'पुस्तकालय');

  String get libHelp => _lw(
    'Books on loan, when they are due, books read before, and reservations. Find a book and see if it is on the shelf.',
    'उधार ली गई किताबें, वे कब लौटानी हैं, पहले पढ़ी गई किताबें और आरक्षण। कोई किताब खोजें और देखें कि वह शेल्फ़ पर है या नहीं।',
  );
  String get libNotLinkedStaff => _lw(
    'Your sign-in is not linked to a staff record. Please contact the school office.',
    'आपका साइन-इन किसी कर्मचारी रिकॉर्ड से नहीं जुड़ा है। कृपया विद्यालय कार्यालय से संपर्क करें।',
  );
  String get libNotLinked => _lw(
    'Your account is not linked to a student yet. Please contact the school office.',
    'आपका खाता अभी किसी विद्यार्थी से नहीं जुड़ा है। कृपया विद्यालय कार्यालय से संपर्क करें।',
  );

  // the figures
  String get libOutNow => _lw('Books out now', 'अभी ली हुई किताबें');
  String get libOverdue => _lw('Overdue', 'लौटाने में देर');
  String get libReadSession => _lw('Read this session', 'इस सत्र में पढ़ी');
  String get libReadMonth => _lw('Read this month', 'इस महीने पढ़ी');
  String get libOnTime => _lw('Returned on time', 'समय पर लौटाई');
  String get libLateFines => _lw('Late fines this session', 'इस सत्र का विलंब जुर्माना');
  String libAvgDays(String n) => _lw('Kept $n days on average', 'औसतन $n दिन रखी');
  String libFinesDue(String m) => _lw('$m of fines due', '$m जुर्माना बाकी');
  String get libNothingDue => _lw('No fine due', 'कोई जुर्माना बाकी नहीं');

  // books now
  String get libReadyToCollect => _lw('Ready to collect', 'लेने के लिए तैयार');
  String libKeptUntil(String d) => _lw('kept until $d', '$d तक रखी है');
  String get libBooksNow => _lw('Books on loan', 'उधार ली गई किताबें');
  String get libNoBooks => _lw('No books on loan.', 'कोई किताब उधार पर नहीं है।');
  String libDueOn(String d) => _lw('Due on $d', 'लौटाने की तिथि: $d');
  String get libOnLoan => _lw('On loan', 'उधार पर');
  String libOverdueDays(int n) => _lw('Overdue · $n ${n == 1 ? 'day' : 'days'}', 'देर · $n दिन');
  String libFineSoFar(String m) => _lw('Fine so far $m', 'अब तक जुर्माना $m');
  String libRenewedN(int n) =>
      _lw('Renewed $n ${n == 1 ? 'time' : 'times'}', '$n बार अवधि बढ़ाई गई');
  String libDuesCounter(String m) => _lw(
    'Library fines and charges due at the fees counter: $m.',
    'शुल्क काउंटर पर जमा करने हैं — पुस्तकालय जुर्माना और शुल्क: $m।',
  );
  String libDuesLibrary(String m) =>
      _lw('Older fines kept at the library: $m.', 'पुस्तकालय में दर्ज पुराने जुर्माने: $m।');

  // reservations
  String get libReservations => _lw('Reservations', 'आरक्षण');
  String get libNoReservations => _lw(
    'None. When every copy of a book is out, reserve it under Find a book.',
    'कोई नहीं। जब किसी किताब की सारी प्रतियाँ बाहर हों, तो "किताब खोजें" में उसे आरक्षित करें।',
  );
  String get libNoOpenReservations =>
      _lw('No reservation is waiting now.', 'अभी कोई आरक्षण प्रतीक्षा में नहीं है।');
  String libUntil(String d) => _lw('until $d', '$d तक');
  String libWaitingPlace(String n) =>
      _lw('Waiting · No. $n in line', 'प्रतीक्षा में · कतार में क्रमांक $n');
  String get libCollected => _lw('Collected', 'ले ली गई');
  String get libLapsed => _lw('Not collected in time', 'समय पर नहीं ली गई');
  String get libCancelledTag => _lw('Cancelled', 'रद्द');
  String libEarlierReservations(int n) => _lw('Earlier reservations ($n)', 'पिछले आरक्षण ($n)');
  String get libCancelReservation => _lw('Cancel the reservation', 'आरक्षण रद्द करें');
  String libCancelAsk(String title, bool self) => _lw(
    'Cancel the reservation of "$title"? The book will no longer be kept for ${self ? 'you' : 'your child'}.',
    '"$title" का आरक्षण रद्द करें? यह किताब अब ${self ? 'आपके' : 'आपके बच्चे के'} लिए नहीं रखी जाएगी।',
  );
  String get libKeepIt => _lw('Keep it', 'रहने दें');
  String get libCancelledMsg => _lw('The reservation is cancelled.', 'आरक्षण रद्द कर दिया गया है।');
  String libReservedMsg(bool self) => _lw(
    'Reserved. When a copy comes back it is kept for ${self ? 'you' : 'your child'}; you will see it on the library page.',
    'आरक्षित हो गई। जब कोई प्रति वापस आएगी तो वह ${self ? 'आपके' : 'आपके बच्चे के'} लिए रखी जाएगी; आप उसे पुस्तकालय पृष्ठ पर देखेंगे।',
  );

  // find a book
  String get libFindBook => _lw('Find a book', 'किताब खोजें');
  String get libFindHelp => _lw(
    'See if a book is on the shelf, or reserve it when every copy is out.',
    'देखें कि किताब शेल्फ़ पर है या नहीं, या सारी प्रतियाँ बाहर हों तो उसे आरक्षित करें।',
  );
  String get libSearchLabel => _lw('Title, author, subject or ISBN', 'शीर्षक, लेखक, विषय या ISBN');
  String get libSearch => _lw('Search', 'खोजें');
  String get libNoBookFound => _lw('No book found.', 'कोई किताब नहीं मिली।');
  String libBooksFound(int n) => _lw('$n ${n == 1 ? 'book' : 'books'}', '$n किताबें');
  String get libOnShelf => _lw('On the shelf', 'शेल्फ़ पर है');
  String get libReferenceOnly => _lw('Read in the library only', 'केवल पुस्तकालय में पढ़ें');
  String get libAllOut => _lw('All copies out', 'सारी प्रतियाँ बाहर हैं');
  String libDueBack(String d) => _lw('due back $d', '$d तक वापस आनी है');
  String libWaitingN(int n) => _lw('$n waiting', '$n प्रतीक्षा में');
  String libHasIt(bool self) => _lw(
    self ? 'You have this book' : 'Your child has this book',
    self ? 'यह किताब आपके पास है' : 'यह किताब आपके बच्चे के पास है',
  );
  String get libReservedTag => _lw('Reserved', 'आरक्षित');
  String get libReserve => _lw('Reserve', 'आरक्षित करें');
  String libReserveFor(String title, String name) =>
      _lw('Reserve $title for $name', '$name के लिए $title आरक्षित करें');
  String libReserveHelp(bool self) => _lw(
    'A book can be reserved when every copy is out. The next copy back is kept for ${self ? 'you' : 'your child'} for a few days; collect it at the library.',
    'किसी किताब को तभी आरक्षित किया जा सकता है जब उसकी सारी प्रतियाँ बाहर हों। वापस आने वाली अगली प्रति कुछ दिनों तक ${self ? 'आपके' : 'आपके बच्चे के'} लिए रखी जाती है; उसे पुस्तकालय से ले लें।',
  );

  // the history
  String libHistoryFold(int n) =>
      _lw('Read before · $n ${n == 1 ? 'book' : 'books'}', 'पहले पढ़ी गई · $n किताबें');
  String get libHistoryHint => _lw(
    'Tap to see every book taken, with filters, Excel and PDF.',
    'ली गई हर किताब फ़िल्टर, Excel और PDF के साथ देखने के लिए टैप करें।',
  );
  String get libTakenFrom => _lw('Taken from', 'इस तिथि से ली गई');
  String get libShow => _lw('Show', 'दिखाएँ');
  String get libBookOrAuthor => _lw('Book or author', 'किताब या लेखक');
  String libStatus(String v) => switch (v) {
    'out' => _lw('Not returned yet', 'अभी लौटाई नहीं'),
    'returned' => _lw('Returned', 'लौटा दी गई'),
    'late' => _lw('Late', 'देर से लौटाई'),
    'renewed' => _lw('Renewed', 'अवधि बढ़ाई गई'),
    'fined' => _lw('With a fine', 'जुर्माने वाली'),
    _ => _lw('All books', 'सभी किताबें'),
  };
  String libBookCount(int n) => _lw('$n ${n == 1 ? 'book' : 'books'}', '$n किताबें');
  String get libNoHistory =>
      _lw('No books for these filters.', 'इन फ़िल्टर के लिए कोई किताब नहीं।');
  String get libHistoryExcel => _lw('Excel of the history', 'इतिहास की Excel फ़ाइल');
  String get libHistoryPdf => _lw('PDF of the history', 'इतिहास की PDF');
  String libTakenOn(String d) => _lw('Taken $d', '$d को ली');
  String libDue(String d) => _lw('due $d', 'लौटानी थी $d');
  String libReturnedOn(String d) => _lw('Returned $d', '$d को लौटाई');
  String get libNotYet => _lw('Not returned yet', 'अभी लौटाई नहीं');
  String libDaysLate(int n) => _lw('$n ${n == 1 ? 'day' : 'days'} late', '$n दिन देर से');
  String get libOnTimeWord => _lw('on time', 'समय पर');
  String libDaysKept(int n) => _lw('kept $n ${n == 1 ? 'day' : 'days'}', '$n दिन रखी');
  String libFine(String m) => _lw('Fine $m', 'जुर्माना $m');
  String libFineStatus(String v) => switch (v) {
    'paid' => _lw('Paid', 'चुकाया गया'),
    'waived' => _lw('Waived', 'माफ़ किया गया'),
    _ => _lw('Due', 'बाकी'),
  };

  // the chart and the digital library
  String get libSixMonths =>
      _lw('Books borrowed, last six months', 'पिछले छह महीनों में ली गई किताबें');
  String libSixMonthsSaid(String list) =>
      _lw('Books borrowed, last six months: $list', 'पिछले छह महीनों में ली गई किताबें: $list');
  String libReadMost(String list) => _lw('Read most: $list', 'सबसे ज़्यादा पढ़ी: $list');
  String get libDigital => _lw('Digital library', 'डिजिटल पुस्तकालय');
  String get libHistoryTab => _lw('History', 'इतिहास');
  String get libNoDigital => _lw(
    'The library has not shared any e-books or links yet.',
    'पुस्तकालय ने अभी कोई ई-पुस्तक या लिंक साझा नहीं किया है।',
  );
  String libOpenLink(String title) => _lw('Open $title', '$title खोलें');
  String get libCannotOpen => _lw('The link could not be opened.', 'लिंक नहीं खुल सका।');
}

const _statuses = ['all', 'out', 'returned', 'late', 'renewed', 'fined'];

int _int(Object? v) => (num.tryParse('${v ?? ''}') ?? 0).toInt();
num _num(Object? v) => num.tryParse('${v ?? ''}') ?? 0;

/// The text of a value, or null when there is none.
String? _str(Object? v) {
  if (v == null) return null;
  final x = '$v'.trim();
  return x.isEmpty ? null : x;
}

/// The values there are, with a dot between.
String _join(List<Object?> xs) => xs.map(_str).whereType<String>().join(' · ');

/// 9 or 9.5
String _n(num n) => n == n.roundToDouble() ? '${n.round()}' : n.toStringAsFixed(1);

String _day(S s, Object? d) => _str(d) == null ? '—' : s.date('$d');

Future<List<Json>> _digital(EduProApi api) async {
  try {
    return asList(asJson(await api.libraryMyDigital())['data']);
  } on ApiException catch (e) {
    // as the website: the digital library missing never stops the page
    if (e.offline) rethrow;
    return const [];
  }
}

/// Whose library: the child's (`student`, the profile's pupil) or, on a staff profile, the staff member's own
/// (`employee`, the one borrower the library summary names), as the staff website finds it. Null: not linked.
final libraryBorrowerProvider = FutureProvider.autoDispose.family<(String, String)?, Profile>((
  ref,
  p,
) async {
  if (!p.isStaff) return p.studentId == null ? null : ('student', p.studentId!);
  try {
    final r = await cached(
      'library-borrower:${p.id}',
      () => ref.read(apiProvider).libraryPortalSummary(),
    );
    for (final x in asList(asJson(r.data)['people'])) {
      if (x['kind'] == 'employee') return ('employee', '${x['id']}');
    }
    return null;
  } on ApiException catch (e) {
    if (e.status == 403 || e.status == 404) return null;
    rethrow;
  }
});

/// The library of the child (or, on a staff profile, the staff member's own), as the website's Library page reads
/// it: the borrower (books now, reservations, dues), the figures from the first page of the history, and the digital
/// library: `{mine, history, digital}`. Null when the account is not linked (no student or staff record, or the API
/// says the borrower is not theirs).
final libraryProvider = FutureProvider.autoDispose.family<Loaded<Json?>, Profile>((ref, p) async {
  final who = await ref.watch(libraryBorrowerProvider(p).future);
  if (who == null) return Loaded<Json?>(null, DateTime.now());
  final (kind, id) = who;
  final api = ref.read(apiProvider);
  try {
    final r = await cached('library:${p.id}', () async {
      final got = await Future.wait<dynamic>([
        api.libraryPortalBorrower(kind: kind, id: id),
        api.libraryPortalHistory(kind: kind, id: id, status: 'all', page: 1),
        _digital(api),
      ]);
      return {'mine': got[0], 'history': got[1], 'digital': got[2]};
    });
    return Loaded<Json?>(asJson(r.data), r.at, stale: r.stale);
  } on ApiException catch (e) {
    if (e.status == 403 || e.status == 404) return Loaded<Json?>(null, DateTime.now());
    rethrow;
  }
});

/// A page of the child's library history with the website's filters: `(profile, from, to, status, search, page)`
/// (empty: no filter; status `all` … `fined`).
final libraryHistoryProvider = FutureProvider.autoDispose
    .family<Loaded<Json>, (Profile, String, String, String, String, int)>((ref, a) async {
      final (p, from, to, status, q, page) = a;
      final (kind, id) = await ref.watch(libraryBorrowerProvider(p).future) ?? ('student', '');
      final r = await cached(
        'libraryHistory:${p.id}:$from:$to:$status:$q:$page',
        () => ref
            .read(apiProvider)
            .libraryPortalHistory(
              kind: kind,
              id: id,
              from: from.isEmpty ? null : from,
              to: to.isEmpty ? null : to,
              status: status,
              q: q.isEmpty ? null : q,
              page: page,
            ),
      );
      return Loaded(asJson(r.data), r.at, stale: r.stale);
    });

/// A page (20) of the school's catalogue, by title, author, subject or ISBN: `(profile, search, page)`. The generated
/// client has no query for this call, so it goes through the transport.
final libraryCatalogueProvider = FutureProvider.autoDispose
    .family<Loaded<Json>, (Profile, String, int)>((ref, a) async {
      final (p, q, page) = a;
      final r = await cached(
        'libraryCatalogue:${p.id}:$q:$page',
        () => ref
            .read(transportProvider)
            .send(
              'GET',
              '/library/portal/catalogue',
              query: {if (q.isNotEmpty) 'q': q, 'page': page},
            ),
      );
      return Loaded(asJson(r.data), r.at, stale: r.stale);
    });

/// The library as the website shows it (apps/parent/app/(app)/library): the figures (books out, overdue, read this
/// session and month, returned on time, late fines), a book kept to collect, the books on loan with the due day and
/// the fine so far, what is due at the fees counter, the reservations (cancelled after a yes), Find a book (the
/// catalogue, reserving a book when every copy is out), the history folded (filters, pages, Excel and PDF), six
/// months of borrowing and the digital library.
class LibraryScreen extends ConsumerStatefulWidget {
  const LibraryScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends ConsumerState<LibraryScreen> {
  String? _message;
  String? _error;

  /// the tab shown, as the Calendar's: books, reservations, find, history, digital
  String _tab = 'books';

  // the history's filters
  DateTime? _from;
  DateTime? _to;
  String _status = 'all';
  String _q = '';
  int _page = 1;
  final _search = TextEditingController();

  Profile get _p => widget.profile;
  bool get _self => _p.kind == 'student' || _p.isStaff;
  bool get _filtered => _from != null || _to != null || _status != 'all' || _q.isNotEmpty;

  /// the history as the main page has it (no filter, page 1): no call of its own
  bool get _plain => !_filtered && _page == 1;

  (Profile, String, String, String, String, int) get _key =>
      (_p, _from == null ? '' : ymd(_from!), _to == null ? '' : ymd(_to!), _status, _q, _page);

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _done(String? message, {String? error}) {
    if (!mounted) return;
    setState(() {
      _message = message;
      _error = error;
    });
    ref.invalidate(libraryProvider(_p));
  }

  Future<void> _cancel(Json r) async {
    final s = ref.read(stringsProvider);
    final yes = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text(s.libCancelReservation),
        content: Text(s.libCancelAsk('${r['title'] ?? ''}', _self)),
        actions: [
          TextButton(
            key: const Key('libKeepReservation'),
            onPressed: () => Navigator.of(c).pop(false),
            child: Text(s.libKeepIt),
          ),
          FilledButton(
            key: const Key('libConfirmCancel'),
            onPressed: () => Navigator.of(c).pop(true),
            child: Text(s.libCancelReservation),
          ),
        ],
      ),
    );
    if (yes != true) return;
    try {
      await ref.read(apiProvider).libraryPortalCancel(id: '${r['id']}');
      _done(s.libCancelledMsg);
    } catch (e) {
      _done(null, error: errorText(s, e));
    }
  }

  Future<void> _pickDate(bool from) async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: (from ? _from : _to) ?? now,
      firstDate: DateTime(now.year - 10),
      lastDate: now,
    );
    if (d == null) return;
    setState(() {
      if (from) {
        _from = d;
      } else {
        _to = d;
      }
      _page = 1;
    });
  }

  void _apply(String v) => setState(() {
    _q = v.trim();
    _page = 1;
  });

  void _clear() => setState(() {
    _from = null;
    _to = null;
    _status = 'all';
    _q = '';
    _search.clear();
    _page = 1;
  });

  /// "Read this session": the History tab.
  void _openHistory() => setState(() => _tab = 'history');

  Future<void> _openLink(Uri u) async {
    final s = ref.read(stringsProvider);
    var opened = false;
    try {
      opened = await launchUrl(u, mode: LaunchMode.externalApplication);
    } catch (_) {
      opened = false;
    }
    if (!opened && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(s.libCannotOpen)));
    }
  }

  Future<ApiFile> _export(String format) async {
    final (kind, id) = await ref.read(libraryBorrowerProvider(_p).future) ?? ('student', '');
    return ref
        .read(apiProvider)
        .libraryPortalHistoryExport(
          kind: kind,
          id: id,
          from: _from == null ? null : ymd(_from!),
          to: _to == null ? null : ymd(_to!),
          status: _status,
          q: _q.isEmpty ? null : _q,
          format: format,
        );
  }

  /// The child, the help line, a message, and the six figures: above every tab.
  List<Widget> _head(S s, Color muted, Json? d) {
    final borrower = asJson(asJson(d?['mine'])['borrower']);
    final st = asJson(asJson(d?['history'])['stats']);
    return [
      Text(
        _join([borrower['name'] ?? _p.name, borrower['place']]),
        style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
      ),
      Text(s.libHelp, style: TextStyle(color: muted, fontSize: 14)),
      const SizedBox(height: Tokens.sp3),
      if (_message != null) ...[Notice(text: _message!), const SizedBox(height: Tokens.sp3)],
      if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp3)],
      if (d != null) ..._figures(s, muted, st),
      const SizedBox(height: Tokens.sp3),
    ];
  }

  /// The Library's parts as tabs, as the Calendar's: books on loan, reservations, find a book, history, digital.
  Widget _tabs(S s, Json? d) {
    final open = asList(asJson(d?['mine'])['reservations'])
        .where((r) => r['status'] == 'waiting' || r['status'] == 'ready')
        .length;
    return Padding(
      padding: const EdgeInsets.only(bottom: Tokens.sp3),
      child: Semantics(
        label: s.libScreenTitle,
        container: true,
        explicitChildNodes: true,
        child: Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp2,
          children: [
            for (final (v, label) in [
              ('books', s.libBooksNow),
              ('reservations', open > 0 ? '${s.libReservations} ($open)' : s.libReservations),
              ('find', s.libFindBook),
              ('history', s.libHistoryTab),
              ('digital', s.libDigital),
            ])
              ChoiceChip(
                key: Key('libTab-$v'),
                label: Text(label),
                selected: _tab == v,
                showCheckmark: false,
                onSelected: (_) => setState(() => _tab = v),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    // Find a book is the catalogue itself, under the same figures and tabs
    if (_tab == 'find') {
      final d = ref.watch(libraryProvider(_p)).value?.data;
      return LibraryCatalogueScreen(
        key: const ValueKey('lib-find'),
        profile: _p,
        header: [..._head(s, muted, d), _tabs(s, d)],
      );
    }
    final history = _plain ? null : ref.watch(libraryHistoryProvider(_key));
    return LoadedList<Json?>(
      key: ValueKey('lib-$_tab'),
      value: ref.watch(libraryProvider(_p)),
      refresh: () {
        if (!_plain) ref.invalidate(libraryHistoryProvider(_key));
        return ref.refresh(libraryProvider(_p).future);
      },
      children: (d) {
        if (d == null) return [EmptyLine(_p.isStaff ? s.libNotLinkedStaff : s.libNotLinked)];
        final mine = asJson(d['mine']);
        final first = asJson(d['history']);
        final now = asList(mine['now']);
        final res = asList(mine['reservations']);
        final open = res.where((r) => r['status'] == 'waiting' || r['status'] == 'ready').toList();
        final ended = res.where((r) => !open.contains(r)).toList();
        final ready = open.where((r) => r['status'] == 'ready').toList();
        final dues = asJson(mine['dues']);
        final atCounter = _num(dues['atCounter']);
        final atLibrary = _num(dues['atLibrary']);
        final digital = asList(d['digital']);
        final st = asJson(first['stats']);
        final months = asList(st['months']);
        final subjects = asList(st['subjects']);
        return [
          ..._head(s, muted, d),
          _tabs(s, d),
          ...switch (_tab) {
            'reservations' => [
              if (res.isEmpty)
                EmptyLine(s.libNoReservations)
              else if (open.isEmpty)
                EmptyLine(s.libNoOpenReservations),
              for (final r in open) Card(child: _reservation(s, muted, r)),
              if (ended.isNotEmpty)
                Card(
                  clipBehavior: Clip.antiAlias,
                  child: ExpansionTile(
                    key: const Key('libEarlierReservations'),
                    leading: const Icon(Icons.history_outlined),
                    title: Text(
                      s.libEarlierReservations(ended.length),
                      style: const TextStyle(fontWeight: Tokens.fwSemibold),
                    ),
                    shape: const Border(),
                    collapsedShape: const Border(),
                    expandedCrossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [for (final r in ended) _reservation(s, muted, r)],
                  ),
                ),
            ],
            'history' => [
              _historyCard(s, muted, first, history),
              if (months.isNotEmpty) ...[
                SectionTitle(s.libSixMonths),
                Card(
                  key: const Key('libMonths'),
                  child: Padding(
                    padding: const EdgeInsets.all(Tokens.sp4),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _MonthBars(months: months, s: s),
                        if (subjects.isNotEmpty) ...[
                          const SizedBox(height: Tokens.sp3),
                          Text(
                            s.libReadMost(
                              subjects
                                  .map((x) => '${x['subject']} (${_int(x['loans'])})')
                                  .join(', '),
                            ),
                            style: TextStyle(color: muted, fontSize: 14),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              ],
            ],
            'digital' => [
              if (digital.isEmpty) EmptyLine(s.libNoDigital),
              for (final x in digital) _digitalRow(s, muted, x),
            ],
            _ => [
              if (ready.isNotEmpty) ...[
                _Band(
                  key: const Key('libReady'),
                  icon: Icons.notifications_active_outlined,
                  text:
                      '${s.libReadyToCollect}: ${ready.map((r) => '${r['title']}${_str(r['library']) != null ? ' (${r['library']})' : ''}, ${s.libKeptUntil(_day(s, r['readyUntil']))}').join('; ')}',
                ),
                const SizedBox(height: Tokens.sp3),
              ],
              if (now.isEmpty) EmptyLine(s.libNoBooks),
              for (final b in now) _bookCard(s, muted, b),
              if (atCounter > 0 || atLibrary > 0) ...[
                const SizedBox(height: Tokens.sp2),
                _Band(
                  key: const Key('libDues'),
                  icon: Icons.account_balance_wallet_outlined,
                  text: [
                    if (atCounter > 0) s.libDuesCounter(s.money(atCounter)),
                    if (atLibrary > 0) s.libDuesLibrary(s.money(atLibrary)),
                  ].join(' '),
                ),
              ],
            ],
          },
        ];
      },
    );
  }

  List<Widget> _figures(S s, Color muted, Json st) {
    final holding = _int(st['holding']);
    final overdue = _int(st['overdue']);
    final onTime = _int(st['onTimeSession']);
    final late = _int(st['lateSession']);
    final avg = _num(st['avgDays']);
    final fines = _num(st['finesSession']);
    final finesDue = math.max<num>(0, fines - _num(st['finesPaid']) - _num(st['finesWaived']));
    return [
      FigureGrid(
        key: const Key('libFigures'),
        tiles: [
          FigureTile(label: s.libOutNow, value: '$holding', icon: Icons.menu_book_outlined),
          FigureTile(
            label: s.libOverdue,
            value: '$overdue',
            icon: Icons.alarm,
            tone: (overdue > 0 ? Tokens.statusDanger : null),
          ),
          FigureTile(
            key: const Key('libFigRead'),
            label: s.libReadSession,
            value: '${_int(st['readSession'])}',
            icon: Icons.auto_stories_outlined,
            onTap: _openHistory,
          ),
          FigureTile(
            label: s.libReadMonth,
            value: '${_int(st['readMonth'])}',
            icon: Icons.calendar_month_outlined,
          ),
          FigureTile(label: s.libOnTime, value: '$onTime/${onTime + late}', icon: Icons.task_alt),
          FigureTile(
            label: s.libLateFines,
            value: s.money(fines),
            icon: Icons.currency_rupee,
            tone: (finesDue > 0 ? Tokens.statusWarning : null),
          ),
        ],
      ),
      const SizedBox(height: Tokens.sp2),
      Text(
        _join([
          avg > 0 ? s.libAvgDays(_n(avg)) : null,
          finesDue > 0 ? s.libFinesDue(s.money(finesDue)) : s.libNothingDue,
        ]),
        key: const Key('libFigNote'),
        style: TextStyle(color: muted, fontSize: 14),
      ),
    ];
  }

  Widget _bookCard(S s, Color muted, Json b) {
    final late = _int(b['daysLate']);
    final fine = _num(b['fine']);
    final renewed = _int(b['renewed']);
    final meta = _join([b['author'], b['accessionNo'], b['library']]);
    return Card(
      key: Key('libBook-${b['id']}'),
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('${b['title'] ?? ''}', style: const TextStyle(fontWeight: Tokens.fwBold)),
            if (meta.isNotEmpty) Text(meta, style: TextStyle(color: muted, fontSize: 13)),
            const SizedBox(height: Tokens.sp2),
            Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp1,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                StatusChip(
                  late > 0 ? s.libOverdueDays(late) : s.libOnLoan,
                  late > 0 ? Tone.danger : Tone.success,
                ),
                Text(s.libDueOn(_day(s, b['dueOn']))),
              ],
            ),
            if (fine > 0 || renewed > 0)
              Padding(
                padding: const EdgeInsets.only(top: Tokens.sp1),
                child: Text(
                  _join([
                    fine > 0 ? s.libFineSoFar(s.money(fine)) : null,
                    renewed > 0 ? s.libRenewedN(renewed) : null,
                  ]),
                  style: const TextStyle(fontWeight: Tokens.fwSemibold),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _reservation(S s, Color muted, Json r) {
    final status = '${r['status']}';
    final title = '${r['title'] ?? ''}';
    final open = status == 'waiting' || status == 'ready';
    final (word, tone) = switch (status) {
      'ready' => (
        _join([s.libReadyToCollect, r['library'], s.libUntil(_day(s, r['readyUntil']))]),
        Tone.warning,
      ),
      'waiting' => (s.libWaitingPlace(_str(r['place']) ?? '–'), Tone.info),
      'collected' => (
        _join([s.libCollected, _str(r['endedOn']) == null ? null : _day(s, r['endedOn'])]),
        Tone.success,
      ),
      'lapsed' => (
        _join([s.libLapsed, _str(r['endedOn']) == null ? null : _day(s, r['endedOn'])]),
        Tone.neutral,
      ),
      _ => (
        _join([s.libCancelledTag, _str(r['endedOn']) == null ? null : _day(s, r['endedOn'])]),
        Tone.neutral,
      ),
    };
    return Padding(
      key: Key('libRes-${r['id']}'),
      padding: const EdgeInsets.all(Tokens.sp4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontWeight: Tokens.fwBold)),
          if (_str(r['author']) != null)
            Text('${r['author']}', style: TextStyle(color: muted, fontSize: 13)),
          const SizedBox(height: Tokens.sp2),
          StatusChip(word, tone),
          if (status == 'cancelled' && _str(r['endReason']) != null)
            Padding(
              padding: const EdgeInsets.only(top: Tokens.sp1),
              child: Text('${r['endReason']}', style: TextStyle(color: muted, fontSize: 13)),
            ),
          if (open)
            Align(
              alignment: AlignmentDirectional.centerEnd,
              child: TextButton(
                key: Key('libCancel-${r['id']}'),
                onPressed: () => _cancel(r),
                child: Text(s.cancel, semanticsLabel: '${s.libCancelReservation}: $title'),
              ),
            ),
        ],
      ),
    );
  }

  Widget _historyCard(S s, Color muted, Json first, AsyncValue<Loaded<Json>>? other) {
    List<Widget> rows(Json h) {
      final list = asList(h['rows']);
      final total = _int(h['total']);
      final page = math.max(1, _int(h['page']));
      final pages = math.max(1, _int(h['pages']));
      return [
        Wrap(
          spacing: Tokens.sp2,
          runSpacing: Tokens.sp1,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            Semantics(
              liveRegion: true,
              child: Text(
                total > 0 ? s.libBookCount(total) : s.libNoHistory,
                key: const Key('libHistCount'),
                style: const TextStyle(fontWeight: Tokens.fwSemibold),
              ),
            ),
            if (total > 0) ...[
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('Excel'),
                  // a spreadsheet does not open in the app: saved or shared
                  IconButton(
                    key: const Key('download-libHistXlsx'),
                    tooltip: '${s.download} ${s.libHistoryExcel}',
                    icon: const Icon(Icons.download_outlined),
                    onPressed: () => shareFile(context, s, () => _export('xlsx')),
                  ),
                ],
              ),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('PDF'),
                  FileIcons(name: 'libHistPdf', label: s.libHistoryPdf, load: () => _export('pdf')),
                ],
              ),
            ],
          ],
        ),
        for (final (i, b) in list.indexed) ...[
          if (i > 0) const Divider(height: 1),
          _historyRow(s, muted, b),
        ],
        if (pages > 1)
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              IconButton(
                key: const Key('libHistPrev'),
                tooltip: s.previous,
                icon: const Icon(Icons.chevron_left),
                onPressed: page > 1 ? () => setState(() => _page = page - 1) : null,
              ),
              Flexible(child: Text(s.pageOf(page, pages))),
              IconButton(
                key: const Key('libHistNext'),
                tooltip: s.next,
                icon: const Icon(Icons.chevron_right),
                onPressed: page < pages ? () => setState(() => _page = page + 1) : null,
              ),
            ],
          ),
      ];
    }

    return Card(
      key: const Key('libHistory'),
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              s.libHistoryFold(_int(first['total'])),
              style: const TextStyle(fontWeight: Tokens.fwSemibold),
            ),
            const SizedBox(height: Tokens.sp3),
            Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp2,
              children: [
                OutlinedButton.icon(
                  key: const Key('libHistFrom'),
                  icon: const Icon(Icons.event),
                  label: Text('${s.libTakenFrom}: ${_from == null ? '—' : s.date(_from!)}'),
                  onPressed: () => _pickDate(true),
                ),
                OutlinedButton.icon(
                  key: const Key('libHistTo'),
                  icon: const Icon(Icons.event),
                  label: Text('${s.givenTo}: ${_to == null ? '—' : s.date(_to!)}'),
                  onPressed: () => _pickDate(false),
                ),
              ],
            ),
            const SizedBox(height: Tokens.sp3),
            DropdownMenu<String>(
              key: const Key('libHistStatus'),
              label: Text(s.libShow),
              initialSelection: _status,
              trailingIcon: dropArrow(s.libShow),
              selectedTrailingIcon: dropArrow(s.libShow, open: true),
              expandedInsets: EdgeInsets.zero,
              enableFilter: true,
              enableSearch: true,
              requestFocusOnTap: true,
              onSelected: (v) => setState(() {
                _status = v ?? 'all';
                _page = 1;
              }),
              dropdownMenuEntries: [
                for (final v in _statuses) DropdownMenuEntry(value: v, label: s.libStatus(v)),
              ],
            ),
            const SizedBox(height: Tokens.sp3),
            TextField(
              key: const Key('libHistSearch'),
              controller: _search,
              maxLength: 80,
              textInputAction: TextInputAction.search,
              decoration: InputDecoration(
                labelText: s.libBookOrAuthor,
                prefixIcon: const Icon(Icons.search),
                suffixIcon: IconButton(
                  key: const Key('libHistGo'),
                  tooltip: s.libSearch,
                  icon: const Icon(Icons.arrow_forward),
                  onPressed: () => _apply(_search.text),
                ),
                border: const OutlineInputBorder(),
                counterText: '',
              ),
              onSubmitted: _apply,
            ),
            if (_filtered)
              Align(
                alignment: AlignmentDirectional.centerEnd,
                child: TextButton(
                  key: const Key('libHistClear'),
                  onPressed: _clear,
                  child: Text(s.clearDates),
                ),
              ),
            const SizedBox(height: Tokens.sp2),
            ...switch (other) {
              null => rows(first),
              AsyncValue(:final value?) => rows(value.data),
              AsyncValue(:final error?) => [
                ErrorText(errorText(s, error)),
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: OutlinedButton(
                    onPressed: () => ref.invalidate(libraryHistoryProvider(_key)),
                    child: Text(s.retry),
                  ),
                ),
              ],
              _ => [
                Padding(
                  padding: const EdgeInsets.all(Tokens.sp4),
                  child: Center(
                    child: Semantics(label: s.loading, child: const CircularProgressIndicator()),
                  ),
                ),
              ],
            },
          ],
        ),
      ),
    );
  }

  Widget _historyRow(S s, Color muted, Json b) {
    final late = _int(b['daysLate']);
    final renewed = _int(b['renewed']);
    final fine = _num(b['fine']);
    final returned = _str(b['returnedOn']);
    final fineStatus = _str(b['fineStatus']);
    final meta = _join([b['author'], b['subject'], b['accessionNo']]);
    return Padding(
      key: Key('libHist-${b['id']}'),
      padding: const EdgeInsets.symmetric(vertical: Tokens.sp3),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('${b['title'] ?? ''}', style: const TextStyle(fontWeight: Tokens.fwBold)),
          if (meta.isNotEmpty) Text(meta, style: TextStyle(color: muted, fontSize: 13)),
          const SizedBox(height: Tokens.sp1),
          Text(
            _join([
              s.libTakenOn(_day(s, b['issuedOn'])),
              s.libDue(_day(s, b['dueOn'])),
              renewed > 0 ? s.libRenewedN(renewed) : null,
            ]),
          ),
          const SizedBox(height: Tokens.sp1),
          Wrap(
            spacing: Tokens.sp2,
            runSpacing: Tokens.sp1,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (returned == null)
                StatusChip(s.libNotYet, Tone.warning)
              else
                Text(s.libReturnedOn(_day(s, returned))),
              if (late > 0)
                StatusChip(s.libDaysLate(late), Tone.danger)
              else
                Text(s.libOnTimeWord, style: TextStyle(color: muted)),
              Text(s.libDaysKept(_int(b['daysKept'])), style: TextStyle(color: muted)),
            ],
          ),
          if (fine > 0)
            Padding(
              padding: const EdgeInsets.only(top: Tokens.sp1),
              child: Text(
                _join([
                  s.libFine(s.money(fine)),
                  fineStatus == null ? null : s.libFineStatus(fineStatus),
                ]),
                style: const TextStyle(fontWeight: Tokens.fwSemibold),
              ),
            ),
        ],
      ),
    );
  }

  Widget _digitalRow(S s, Color muted, Json x) {
    final title = '${x['title'] ?? ''}';
    final url = Uri.tryParse('${x['url'] ?? ''}');
    // only a web link opens (never another scheme a record might hold)
    final link =
        url != null && (url.scheme == 'https' || url.scheme == 'http') && url.host.isNotEmpty;
    final meta = _join([x['author'], x['category']]);
    return Card(
      key: Key('libDigital-${x['id']}'),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(Tokens.sp4, Tokens.sp3, Tokens.sp2, Tokens.sp3),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontWeight: Tokens.fwBold)),
                  if (meta.isNotEmpty) Text(meta, style: TextStyle(color: muted, fontSize: 13)),
                  if (_str(x['description']) != null)
                    Padding(
                      padding: const EdgeInsets.only(top: Tokens.sp1),
                      child: Text('${x['description']}', style: const TextStyle(fontSize: 14)),
                    ),
                ],
              ),
            ),
            if (link)
              IconButton(
                key: Key('libOpen-${x['id']}'),
                tooltip: s.libOpenLink(title),
                icon: const Icon(Icons.open_in_new),
                onPressed: () => _openLink(url),
              ),
          ],
        ),
      ),
    );
  }
}

/// A line on the warning tint: a book kept to collect, what is due at the fees counter.
class _Band extends StatelessWidget {
  const _Band({super.key, required this.icon, required this.text});
  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(Tokens.sp3),
    decoration: BoxDecoration(
      color: Tokens.statusWarningBg,
      borderRadius: BorderRadius.circular(Tokens.radiusSm),
    ),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 20, color: Tokens.statusWarning),
        const SizedBox(width: Tokens.sp2),
        Expanded(
          child: Text(text, style: const TextStyle(color: Tokens.textBody)),
        ),
      ],
    ),
  );
}

/// Six months of borrowing as small bars, said as one line to a screen reader.
class _MonthBars extends StatelessWidget {
  const _MonthBars({required this.months, required this.s});
  final List<Json> months;
  final S s;

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final top = months.fold<int>(1, (m, x) => math.max(m, _int(x['issued'])));
    String label(Json m) {
      final d = DateTime.tryParse('${m['month']}-01');
      return d == null ? '${m['month']}' : s.monthShort(d);
    }

    return Semantics(
      label: s.libSixMonthsSaid(months.map((m) => '${label(m)} ${_int(m['issued'])}').join(', ')),
      excludeSemantics: true,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          for (final m in months)
            Expanded(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 3),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Text(
                        '${_int(m['issued'])}',
                        style: const TextStyle(fontWeight: Tokens.fwSemibold, fontSize: 13),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Container(
                      height: math.max(3.0, 72.0 * _int(m['issued']) / top),
                      decoration: BoxDecoration(
                        color: (dark ? Tokens.mobCyan500 : Tokens.mobCyan600),
                        borderRadius: const BorderRadius.vertical(top: Radius.circular(4)),
                      ),
                    ),
                    const SizedBox(height: Tokens.sp1),
                    FittedBox(
                      fit: BoxFit.scaleDown,
                      child: Text(label(m), style: const TextStyle(fontSize: 12)),
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

/// Find a book, as the website's "Find a book": the catalogue by title, author, subject or ISBN, twenty a page,
/// each book on the shelf (and where) or out (and when the first copy is due back, never who has it), and Reserve
/// when every copy is out — not for a book the child has or has reserved already.
class LibraryCatalogueScreen extends ConsumerStatefulWidget {
  const LibraryCatalogueScreen({super.key, required this.profile, this.header = const []});
  final Profile profile;

  /// shown first: the Library's figures and tabs when Find a book is one of its tabs
  final List<Widget> header;

  @override
  ConsumerState<LibraryCatalogueScreen> createState() => _LibraryCatalogueScreenState();
}

class _LibraryCatalogueScreenState extends ConsumerState<LibraryCatalogueScreen> {
  String _q = '';
  int _page = 1;
  final _search = TextEditingController();
  final _busy = <String>{};
  String? _message;
  String? _error;

  Profile get _p => widget.profile;
  bool get _self => _p.kind == 'student' || _p.isStaff;
  (Profile, String, int) get _key => (_p, _q, _page);

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _apply(String v) => setState(() {
    _q = v.trim();
    _page = 1;
    _message = null;
    _error = null;
  });

  Future<void> _reserve(String titleId) async {
    final s = ref.read(stringsProvider);
    final who = await ref.read(libraryBorrowerProvider(_p).future);
    if (who == null) return;
    final (kind, id) = who;
    setState(() {
      _busy.add(titleId);
      _message = null;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .libraryPortalReserve(
            body: PortalReserveDto(borrowerKind: kind, borrowerId: id, titleId: titleId),
          );
      if (!mounted) return;
      _message = s.libReservedMsg(_self);
      ref.invalidate(libraryProvider(_p));
      ref.invalidate(libraryCatalogueProvider(_key));
    } catch (e) {
      if (mounted) _error = errorText(s, e);
    } finally {
      if (mounted) setState(() => _busy.remove(titleId));
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = (dark ? Tokens.mobGray300 : Tokens.textMuted);
    final mine = asJson(ref.watch(libraryProvider(_p)).value?.data?['mine']);
    final holding = {for (final b in asList(mine['now'])) '${b['titleId']}'};
    final reserved = {
      for (final r in asList(mine['reservations']))
        if (r['status'] == 'waiting' || r['status'] == 'ready') '${r['titleId']}',
    };
    final name = _str(asJson(mine['borrower'])['name']) ?? _p.name;
    return LoadedList<Json>(
      value: ref.watch(libraryCatalogueProvider(_key)),
      refresh: () => ref.refresh(libraryCatalogueProvider(_key).future),
      children: (c) {
        final rows = asList(c['rows']);
        final total = _int(c['total']);
        final page = math.max(1, _int(c['page']));
        final pages = math.max(1, _int(c['pages']));
        return [
          ...widget.header,
          Text(s.libFindHelp, style: TextStyle(color: muted, fontSize: 14)),
          const SizedBox(height: Tokens.sp3),
          if (_message != null) ...[Notice(text: _message!), const SizedBox(height: Tokens.sp3)],
          if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp3)],
          TextField(
            key: const Key('libCatSearch'),
            controller: _search,
            maxLength: 80,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              labelText: s.libSearchLabel,
              prefixIcon: const Icon(Icons.search),
              suffixIcon: IconButton(
                key: const Key('libCatGo'),
                tooltip: s.libSearch,
                icon: const Icon(Icons.arrow_forward),
                onPressed: () => _apply(_search.text),
              ),
              border: const OutlineInputBorder(),
              counterText: '',
            ),
            onSubmitted: _apply,
          ),
          const SizedBox(height: Tokens.sp2),
          Semantics(
            liveRegion: true,
            child: Text(
              rows.isEmpty ? s.libNoBookFound : s.libBooksFound(total),
              key: const Key('libCatCount'),
              style: TextStyle(color: muted, fontSize: 14),
            ),
          ),
          const SizedBox(height: Tokens.sp2),
          for (final b in rows)
            _titleCard(
              s,
              muted,
              b,
              name,
              holding.contains('${b['titleId']}'),
              reserved.contains('${b['titleId']}'),
            ),
          if (pages > 1)
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                IconButton(
                  key: const Key('libCatPrev'),
                  tooltip: s.previous,
                  icon: const Icon(Icons.chevron_left),
                  onPressed: page > 1 ? () => setState(() => _page = page - 1) : null,
                ),
                Flexible(child: Text(s.pageOf(page, pages))),
                IconButton(
                  key: const Key('libCatNext'),
                  tooltip: s.next,
                  icon: const Icon(Icons.chevron_right),
                  onPressed: page < pages ? () => setState(() => _page = page + 1) : null,
                ),
              ],
            ),
          const SizedBox(height: Tokens.sp3),
          Text(s.libReserveHelp(_self), style: TextStyle(color: muted, fontSize: 13)),
        ];
      },
    );
  }

  Widget _titleCard(S s, Color muted, Json b, String name, bool has, bool reserved) {
    final id = '${b['titleId']}';
    final title = '${b['title'] ?? ''}';
    final onShelf = _int(b['onShelf']);
    final queue = _int(b['queue']);
    final meta = _join([b['author'], b['subject'], b['publisher'], b['year']]);
    final (word, tone) = onShelf > 0
        ? (_join([s.libOnShelf, b['libraries']]), Tone.success)
        : b['reference'] == true
        ? (s.libReferenceOnly, Tone.neutral)
        : (
            _join([
              s.libAllOut,
              _str(b['nextBack']) == null ? null : s.libDueBack(_day(s, b['nextBack'])),
            ]),
            Tone.warning,
          );
    return Card(
      key: Key('libTitle-$id'),
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontWeight: Tokens.fwBold)),
            if (meta.isNotEmpty) Text(meta, style: TextStyle(color: muted, fontSize: 13)),
            const SizedBox(height: Tokens.sp2),
            Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp1,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                StatusChip(word, tone),
                if (queue > 0) Text(s.libWaitingN(queue), style: TextStyle(color: muted)),
              ],
            ),
            if (has || reserved) ...[
              const SizedBox(height: Tokens.sp2),
              has
                  ? Text(
                      s.libHasIt(_self),
                      key: Key('libHas-$id'),
                      style: const TextStyle(fontWeight: Tokens.fwSemibold),
                    )
                  : StatusChip(s.libReservedTag, Tone.info),
            ] else if (b['canReserve'] == true &&
                ref.watch(libraryBorrowerProvider(_p)).value != null)
              Align(
                alignment: AlignmentDirectional.centerEnd,
                child: FilledButton(
                  key: Key('libReserve-$id'),
                  onPressed: _busy.contains(id) ? null : () => _reserve(id),
                  child: Text(s.libReserve, semanticsLabel: s.libReserveFor(title, name)),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
