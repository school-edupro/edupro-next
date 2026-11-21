import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/family/common.dart';
import 'package:edupro/family/data.dart';
import 'package:edupro/family/library.dart';
import 'package:edupro/l10n/strings.dart';
import 'package:edupro/profiles/profiles.dart';
import 'package:edupro/theme/theme.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fakes.dart';

/// The Library screen against a made-up school library. Every name, book, number and amount here is made up.
final now = DateTime.now();
String day(int offset) => ymd(DateTime(now.year, now.month, now.day).add(Duration(days: offset)));

const parent = Profile(
  id: 'parent:7:41',
  kind: 'parent',
  schoolId: '7',
  schoolName: 'Sample School',
  name: 'Kid Sample',
  app: 'parent',
  detail: 'VI-A · A1234',
  studentId: '41',
);

const unlinked = Profile(
  id: 'parent:7:0',
  kind: 'parent',
  schoolId: '7',
  schoolName: 'Sample School',
  name: 'A Parent',
  app: 'parent',
);

const base = '/library/portal/borrowers/student/41';

/// What the fake library answers; [empty]: a child who never borrowed; [missing]: not this family's child.
class Lib {
  Lib({this.empty = false, this.missing = false});
  final bool empty;
  final bool missing;

  late final reservations = <Map<String, Object?>>[
    if (!empty) ...[
      {
        'id': 'r1',
        'status': 'waiting',
        'placedOn': day(-3),
        'readyUntil': null,
        'endReason': null,
        'endedOn': null,
        'titleId': 't2',
        'title': 'Stars at Night',
        'author': 'B. Poet',
        'accessionNo': null,
        'library': null,
        'place': 2,
      },
      {
        'id': 'r2',
        'status': 'ready',
        'placedOn': day(-9),
        'readyUntil': day(2),
        'endReason': null,
        'endedOn': null,
        'titleId': 't7',
        'title': 'Ocean Life',
        'author': null,
        'accessionNo': 'ACC-310',
        'library': 'Main library',
        'place': null,
      },
      {
        'id': 'r3',
        'status': 'lapsed',
        'placedOn': day(-40),
        'readyUntil': day(-30),
        'endReason': null,
        'endedOn': day(-30),
        'titleId': 't8',
        'title': 'Old Maps',
        'author': null,
        'accessionNo': null,
        'library': 'Main library',
        'place': null,
      },
    ],
  ];

  Map<String, Object?> borrower() => {
    'borrower': {'id': '41', 'name': 'Kid Sample', 'ref': 'A1234', 'place': 'VI-A'},
    'now': empty
        ? []
        : [
            {
              'id': 'l1',
              'accessionNo': 'ACC-101',
              'titleId': 't1',
              'title': 'The Blue River',
              'author': 'A. Writer',
              'library': 'Main library',
              'issuedOn': day(-18),
              'dueOn': day(-4),
              'returnedOn': null,
              'renewed': 1,
              'daysLate': 4,
              'fine': 8,
            },
            {
              'id': 'l2',
              'accessionNo': 'ACC-205',
              'titleId': 't3',
              'title': 'Numbers Are Fun',
              'author': null,
              'library': 'Junior library',
              'issuedOn': day(-2),
              'dueOn': day(12),
              'returnedOn': null,
              'renewed': 0,
              'daysLate': 0,
              'fine': 0,
            },
          ],
    'history': [],
    'reservations': reservations,
    'dues': {'atCounter': empty ? 0 : 25, 'atLibrary': empty ? 0 : 5.5},
  };

  Map<String, Object?> get stats => {
    'sessionFrom': '${now.month >= 4 ? now.year : now.year - 1}-04-01',
    'holding': empty ? 0 : 2,
    'overdue': empty ? 0 : 1,
    'readSession': empty ? 0 : 14,
    'readMonth': empty ? 0 : 3,
    'readEver': empty ? 0 : 30,
    'lateSession': empty ? 0 : 2,
    'onTimeSession': empty ? 0 : 10,
    'avgDays': empty ? 0 : 9.5,
    'finesSession': empty ? 0 : 18,
    'finesPaid': empty ? 0 : 10,
    'finesWaived': 0,
    'months': [
      for (var i = 5; i >= 0; i--)
        {'month': ym(DateTime(now.year, now.month - i)), 'issued': empty ? 0 : i + 1},
    ],
    'subjects': empty
        ? []
        : [
            {'subject': 'Fiction', 'loans': 9},
            {'subject': 'Science', 'loans': 3},
          ],
  };

  Map<String, Object?> row(
    String id,
    String title, {
    String? returned,
    int late = 0,
    num fine = 0,
    String? fineStatus,
  }) => {
    'id': id,
    'accessionNo': 'ACC-$id',
    'titleId': 'T$id',
    'title': title,
    'author': 'C. Author',
    'library': 'Main library',
    'subject': 'Fiction',
    'issuedOn': day(-30),
    'dueOn': day(-16),
    'returnedOn': returned,
    'renewed': 0,
    'daysLate': late,
    'daysKept': 14 + late,
    'fine': fine,
    'waived': 0,
    'fineStatus': fineStatus,
  };

  Map<String, Object?> history(Map<String, Object?> q) {
    final page = (q['page'] as int?) ?? 1;
    if (empty) return {'stats': stats, 'rows': [], 'total': 0, 'page': 1, 'pages': 1};
    if (q['status'] == 'late') {
      return {
        'stats': stats,
        'rows': page == 1
            ? [
                row(
                  'h2',
                  'Late Return Book',
                  returned: day(-10),
                  late: 6,
                  fine: 10,
                  fineStatus: 'paid',
                ),
              ]
            : [row('h9', 'Page Two Book', returned: day(-50))],
        'total': 22,
        'page': page,
        'pages': 2,
      };
    }
    return {
      'stats': stats,
      'rows': [
        row('h1', 'Garden Birds', returned: day(-17)),
        row('h2', 'Late Return Book', returned: day(-10), late: 6, fine: 10, fineStatus: 'paid'),
        row('h3', 'Still Out Book', late: 3),
      ],
      'total': 3,
      'page': 1,
      'pages': 1,
    };
  }

  Map<String, Object?> title(
    String id,
    String name, {
    int onShelf = 0,
    bool reference = false,
    String? nextBack,
    int queue = 0,
    String? libraries,
  }) => {
    'titleId': id,
    'title': name,
    'author': 'D. Author',
    'publisher': 'Made-up Press',
    'year': 2020,
    'subject': 'Fiction',
    'material': 'Book',
    'copies': 2,
    'onShelf': onShelf,
    'libraries': libraries,
    'nextBack': nextBack,
    'queue': queue,
    'reference': reference,
    'canReserve': !reference && onShelf == 0,
  };

  Map<String, Object?> catalogue(Map<String, Object?> q) {
    final page = (q['page'] as int?) ?? 1;
    if (empty) return {'rows': [], 'total': 0, 'page': 1, 'pages': 1};
    final rows = [
      title('t1', 'The Blue River', nextBack: day(-4)),
      title('t2', 'Stars at Night', nextBack: day(6), queue: 1),
      title('t9', 'Mountain Tales', nextBack: day(5), queue: 1),
      title('t5', 'Garden Birds', onShelf: 2, libraries: 'Main library'),
      title('t6', 'Atlas of India', reference: true),
    ];
    final words = '${q['q'] ?? ''}'.toLowerCase();
    if (words.isNotEmpty) {
      final found = rows.where((r) => '${r['title']}'.toLowerCase().contains(words)).toList();
      return {'rows': found, 'total': found.length, 'page': 1, 'pages': 1};
    }
    return {
      'rows': page == 1 ? rows : [title('t20', 'Second Page Book', onShelf: 1)],
      'total': 21,
      'page': page,
      'pages': 2,
    };
  }

  dynamic answer(Call c) {
    final key = '${c.method} ${c.path}';
    switch (key) {
      case 'GET $base':
        if (missing) throw const ApiException(404, 'not-found', 'Borrower not found');
        return borrower();
      case 'GET $base/history':
        if (missing) throw const ApiException(404, 'not-found', 'Borrower not found');
        return history(c.query ?? const {});
      case 'GET $base/history/export':
        return ApiFile(
          bytes: const [80, 75, 3, 4],
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          name: 'Library-history-A1234.${(c.query ?? const {})['format']}',
        );
      case 'GET /library/mine/digital':
        return {
          'data': empty
              ? []
              : [
                  {
                    'id': 'd1',
                    'title': 'Read Along Stories',
                    'author': 'E. Teller',
                    'url': 'https://example.test/stories',
                    'category': 'E-books',
                    'description': 'Picture stories for young readers',
                  },
                  {
                    'id': 'd2',
                    'title': 'Offline Workbook',
                    'author': null,
                    'url': 'javascript:alert(1)',
                    'category': null,
                    'description': null,
                  },
                ],
        };
      case 'GET /library/portal/catalogue':
        return catalogue(c.query ?? const {});
      case 'POST /library/portal/reservations':
        final r = {
          'id': 'r9',
          'status': 'waiting',
          'placedOn': day(0),
          'readyUntil': null,
          'endReason': null,
          'endedOn': null,
          'titleId': '${c.body!['titleId']}',
          'title': 'Mountain Tales',
          'author': 'D. Author',
          'accessionNo': null,
          'library': null,
          'place': 2,
        };
        reservations.add(r);
        return r;
    }
    final cancel = RegExp(r'^/library/portal/reservations/(\w+)/cancel$').firstMatch(c.path);
    if (c.method == 'POST' && cancel != null) {
      final r = reservations.firstWhere((x) => x['id'] == cancel.group(1));
      r['status'] = 'cancelled';
      r['endedOn'] = day(0);
      r['endReason'] = 'Cancelled by the borrower';
      return {'id': r['id'], 'status': 'cancelled'};
    }
    throw ApiException(404, 'not-found', 'no fake for $key');
  }
}

Future<FakeTransport> pumpLibrary(
  WidgetTester tester,
  Lib lib, {
  Profile profile = parent,
  bool hindi = false,
  bool dark = false,
  double scale = 1,
}) async {
  SharedPreferences.setMockInitialValues({'hindi': hindi});
  final t = FakeTransport(lib.answer);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [transportProvider.overrideWithValue(t)],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: eduproTheme(brightness: Brightness.light, webFonts: false),
        darkTheme: eduproTheme(brightness: Brightness.dark, webFonts: false),
        themeMode: dark ? ThemeMode.dark : ThemeMode.light,
        locale: Locale(hindi ? 'hi' : 'en'),
        supportedLocales: const [Locale('en'), Locale('hi')],
        localizationsDelegates: GlobalMaterialLocalizations.delegates,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
          child: child!,
        ),
        home: FamilyPage(
          title: hindi ? 'पुस्तकालय' : 'Library',
          child: LibraryScreen(profile: profile),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return t;
}

Call last(FakeTransport t, String path) => t.calls.lastWhere((c) => c.path == path);

/// Opens one of the Library's tabs (they sit under the figures, as the Calendar's).
Future<void> tab(WidgetTester tester, String name) async {
  final f = find.byKey(Key('libTab-$name'));
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
  await tester.tap(f);
  await tester.pumpAndSettle();
}

Future<void> tall(WidgetTester tester, [double height = 3200]) async {
  await tester.binding.setSurfaceSize(Size(420, height));
  addTearDown(() => tester.binding.setSurfaceSize(null));
}

void main() {
  const s = S(false);

  testWidgets('books out with the due day and the fine so far, the figures, a book to collect, the '
      'dues, reservations, six months and the digital library', (tester) async {
    await tall(tester);
    final t = await pumpLibrary(tester, Lib());
    // the website's three calls: the borrower, the history's first page (the figures), the digital library
    expect(t.calls.any((c) => c.path == base), isTrue);
    expect(last(t, '$base/history').query, {'status': 'all', 'page': 1});
    expect(t.calls.any((c) => c.path == '/library/mine/digital'), isTrue);
    expect(find.text('Kid Sample · VI-A'), findsOneWidget);

    Finder fig(String x) =>
        find.descendant(of: find.byKey(const Key('libFigures')), matching: find.text(x));
    for (final x in ['Books out now', '2', 'Overdue', '1', 'Read this session', '14', '3']) {
      expect(fig(x), findsOneWidget, reason: x);
    }
    expect(fig('10/12'), findsOneWidget);
    expect(fig('₹18'), findsOneWidget);
    expect(find.text('Kept 9.5 days on average · ₹8 of fines due'), findsOneWidget);

    // kept to collect
    expect(
      find.text('Ready to collect: Ocean Life (Main library), kept until ${s.date(day(2))}'),
      findsOneWidget,
    );
    // the books on loan: late with the fine, on loan with the due day
    final late = find.byKey(const Key('libBook-l1'));
    expect(find.descendant(of: late, matching: find.text('Overdue · 4 days')), findsOneWidget);
    expect(
      find.descendant(of: late, matching: find.text('Due on ${s.date(day(-4))}')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: late, matching: find.text('Fine so far ₹8 · Renewed 1 time')),
      findsOneWidget,
    );
    expect(
      find.descendant(of: late, matching: find.text('A. Writer · ACC-101 · Main library')),
      findsOneWidget,
    );
    final ok = find.byKey(const Key('libBook-l2'));
    expect(find.descendant(of: ok, matching: find.text('On loan')), findsOneWidget);
    expect(
      find.descendant(of: ok, matching: find.text('Due on ${s.date(day(12))}')),
      findsOneWidget,
    );
    expect(
      find.text(
        'Library fines and charges due at the fees counter: ₹25. Older fines kept at the library: ₹5.50.',
      ),
      findsOneWidget,
    );
    // the reservations tab: waiting with the place in line, kept until a day, the ended one folded
    expect(find.text('Reservations (2)'), findsOneWidget);
    await tab(tester, 'reservations');
    expect(find.text('Waiting · No. 2 in line'), findsOneWidget);
    expect(find.text('Ready to collect · Main library · until ${s.date(day(2))}'), findsOneWidget);
    expect(find.byKey(const Key('libCancel-r1')), findsOneWidget);
    expect(find.byKey(const Key('libCancel-r2')), findsOneWidget);
    expect(find.text('Earlier reservations (1)'), findsOneWidget);
    expect(find.text('Old Maps'), findsNothing);
    await tester.tap(find.text('Earlier reservations (1)'));
    await tester.pumpAndSettle();
    expect(find.text('Not collected in time · ${s.date(day(-30))}'), findsOneWidget);
    expect(find.byKey(const Key('libCancel-r3')), findsNothing);
    // the history tab, with six months of borrowing and the subjects read most
    expect(find.byKey(const Key('libHistSearch')), findsNothing);
    await tab(tester, 'history');
    expect(find.text('Read before · 3 books'), findsOneWidget);
    expect(find.byKey(const Key('libHistSearch')), findsOneWidget);
    expect(find.byKey(const Key('libMonths')), findsOneWidget);
    expect(find.text('Read most: Fiction (9), Science (3)'), findsOneWidget);
    // the digital library tab: a web link opens, a link of another kind does not
    await tab(tester, 'digital');
    expect(find.text('Read Along Stories'), findsOneWidget);
    expect(find.text('E. Teller · E-books'), findsOneWidget);
    expect(find.byKey(const Key('libOpen-d1')), findsOneWidget);
    expect(find.byKey(const Key('libOpen-d2')), findsNothing);
    // nothing written
    expect(t.calls.where((c) => c.method != 'GET'), isEmpty);
  });

  testWidgets(
    'the history: filters send the website\'s query, pages, the Excel and PDF of the rows '
    'as filtered',
    (tester) async {
      await tall(tester);
      final t = await pumpLibrary(tester, Lib());
      final calls = t.calls.where((c) => c.path == '$base/history').length;
      await tab(tester, 'history');
      // the first page is the one the figures came with: no second call
      expect(t.calls.where((c) => c.path == '$base/history').length, calls);
      expect(find.text('3 books'), findsOneWidget);
      final row = find.byKey(const Key('libHist-h2'));
      expect(
        find.descendant(
          of: row,
          matching: find.text('Taken ${s.date(day(-30))} · due ${s.date(day(-16))}'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(of: row, matching: find.text('Returned ${s.date(day(-10))}')),
        findsOneWidget,
      );
      expect(find.descendant(of: row, matching: find.text('6 days late')), findsOneWidget);
      expect(find.descendant(of: row, matching: find.text('kept 20 days')), findsOneWidget);
      expect(find.descendant(of: row, matching: find.text('Fine ₹10 · Paid')), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(const Key('libHist-h3')),
          matching: find.text('Not returned yet'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(of: find.byKey(const Key('libHist-h1')), matching: find.text('on time')),
        findsOneWidget,
      );

      // a status (type-to-search list)
      await tester.tap(find.byKey(const Key('libHistStatus')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Late').last);
      await tester.pumpAndSettle();
      expect(last(t, '$base/history').query, {'status': 'late', 'page': 1});
      expect(find.text('22 books'), findsOneWidget);
      expect(find.text('Page 1 / 2'), findsOneWidget);
      // a search
      await tester.enterText(find.byKey(const Key('libHistSearch')), 'river');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pumpAndSettle();
      expect(last(t, '$base/history').query, {'status': 'late', 'q': 'river', 'page': 1});
      // taken from a day
      await tester.tap(find.byKey(const Key('libHistFrom')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('1').last);
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      final first = ymd(DateTime(now.year, now.month, 1));
      expect(last(t, '$base/history').query, {
        'from': first,
        'status': 'late',
        'q': 'river',
        'page': 1,
      });
      expect(find.text('Taken from: ${s.date(first)}'), findsOneWidget);
      // the next page
      await tester.tap(find.byKey(const Key('libHistNext')));
      await tester.pumpAndSettle();
      expect(last(t, '$base/history').query!['page'], 2);
      expect(find.text('Page Two Book'), findsOneWidget);

      // Excel: saved or shared, the rows as filtered
      await tester.tap(find.byKey(const Key('download-libHistXlsx')));
      await tester.pumpAndSettle();
      expect(last(t, '$base/history/export').query, {
        'from': first,
        'status': 'late',
        'q': 'river',
        'format': 'xlsx',
      });
      // PDF: opens in the app
      await tester.tap(find.byKey(const Key('view-libHistPdf')));
      await tester.pumpAndSettle();
      expect(last(t, '$base/history/export').query!['format'], 'pdf');
      expect(find.text('PDF of the history'), findsWidgets);
      await tester.tap(find.byType(BackButton));
      await tester.pumpAndSettle();

      // cleared: back to the first page as it came
      await tester.tap(find.byKey(const Key('libHistClear')));
      await tester.pumpAndSettle();
      expect(find.text('3 books'), findsOneWidget);
      expect(find.text('Taken from: —'), findsOneWidget);
      expect(find.text('All books'), findsWidgets);
    },
  );

  testWidgets('"Read this session" opens the history', (tester) async {
    await tester.binding.setSurfaceSize(const Size(400, 800));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await pumpLibrary(tester, Lib());
    expect(find.byKey(const Key('libHistSearch')), findsNothing);
    await tester.tap(find.byKey(const Key('libFigRead')));
    await tester.pumpAndSettle();
    expect(tester.widget<ChoiceChip>(find.byKey(const Key('libTab-history'))).selected, isTrue);
    await tester.dragUntilVisible(
      find.byKey(const Key('libHistSearch')),
      find.byType(ListView).first,
      const Offset(0, -300),
    );
    expect(find.byKey(const Key('libHistSearch')), findsOneWidget);
  });

  testWidgets(
    'find a book: the catalogue, a search, a page, reserving a book when every copy is out',
    (tester) async {
      await tall(tester);
      final t = await pumpLibrary(tester, Lib());
      await tab(tester, 'find');
      expect(last(t, '/library/portal/catalogue').query, {'page': 1});
      expect(find.text('21 books'), findsOneWidget);
      // on the shelf, out with the day the first copy is due back, read in the library only
      expect(find.text('On the shelf · Main library'), findsOneWidget);
      expect(find.text('All copies out · due back ${s.date(day(5))}'), findsOneWidget);
      expect(find.text('Read in the library only'), findsOneWidget);
      expect(find.text('1 waiting'), findsNWidgets(2));
      // the child has one, has reserved another: no Reserve for those; none for a book on the shelf
      expect(find.byKey(const Key('libHas-t1')), findsOneWidget);
      expect(find.text('Your child has this book'), findsOneWidget);
      expect(
        find.descendant(of: find.byKey(const Key('libTitle-t2')), matching: find.text('Reserved')),
        findsOneWidget,
      );
      for (final id in ['t1', 't2', 't5', 't6']) {
        expect(find.byKey(Key('libReserve-$id')), findsNothing, reason: id);
      }
      // reserving
      await tester.tap(find.byKey(const Key('libReserve-t9')));
      await tester.pumpAndSettle();
      final sent = last(t, '/library/portal/reservations');
      expect(sent.method, 'POST');
      expect(sent.body, {'borrowerKind': 'student', 'borrowerId': '41', 'titleId': 't9'});
      expect(
        find.text(
          'Reserved. When a copy comes back it is kept for your child; you will see it on the library page.',
        ),
        findsOneWidget,
      );
      expect(find.byKey(const Key('libReserve-t9')), findsNothing);
      expect(
        find.descendant(of: find.byKey(const Key('libTitle-t9')), matching: find.text('Reserved')),
        findsOneWidget,
      );
      // the next page
      await tester.tap(find.byKey(const Key('libCatNext')));
      await tester.pumpAndSettle();
      expect(last(t, '/library/portal/catalogue').query, {'page': 2});
      expect(find.text('Second Page Book'), findsOneWidget);
      // a search (from the first page)
      await tester.enterText(find.byKey(const Key('libCatSearch')), 'river');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pumpAndSettle();
      expect(last(t, '/library/portal/catalogue').query, {'q': 'river', 'page': 1});
      expect(find.text('1 book'), findsOneWidget);
      expect(find.text('The Blue River'), findsOneWidget);
      // on the Reservations tab the new reservation is there
      await tab(tester, 'reservations');
      expect(find.byKey(const Key('libRes-r9')), findsOneWidget);
    },
  );

  testWidgets('a reservation is cancelled only after a yes', (tester) async {
    await tall(tester);
    final t = await pumpLibrary(tester, Lib());
    bool cancelled() => t.calls.any((c) => c.method == 'POST' && c.path.endsWith('/cancel'));
    await tab(tester, 'reservations');
    await tester.tap(find.byKey(const Key('libCancel-r1')));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsOneWidget);
    expect(
      find.text(
        'Cancel the reservation of "Stars at Night"? The book will no longer be kept for your child.',
      ),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const Key('libKeepReservation')));
    await tester.pumpAndSettle();
    expect(cancelled(), isFalse);
    await tester.tap(find.byKey(const Key('libCancel-r1')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('libConfirmCancel')));
    await tester.pumpAndSettle();
    final sent = last(t, '/library/portal/reservations/r1/cancel');
    expect(sent.method, 'POST');
    expect(find.text('The reservation is cancelled.'), findsOneWidget);
    // reloaded: the cancelled one is with the earlier ones
    expect(find.byKey(const Key('libCancel-r1')), findsNothing);
    expect(find.text('Earlier reservations (2)'), findsOneWidget);
  });

  testWidgets('empty: no books, no reservations, no history, no digital library, no book found', (
    tester,
  ) async {
    await tall(tester);
    final t = await pumpLibrary(tester, Lib(empty: true));
    expect(find.text('No books on loan.'), findsOneWidget);
    expect(find.text('No fine due'), findsOneWidget);
    expect(find.byKey(const Key('libReady')), findsNothing);
    expect(find.byKey(const Key('libDues')), findsNothing);
    await tab(tester, 'reservations');
    expect(
      find.text('None. When every copy of a book is out, reserve it under Find a book.'),
      findsOneWidget,
    );
    await tab(tester, 'digital');
    expect(find.text('The library has not shared any e-books or links yet.'), findsOneWidget);
    await tab(tester, 'history');
    expect(find.textContaining('Read most'), findsNothing);
    expect(find.text('No books for these filters.'), findsOneWidget);
    expect(find.byKey(const Key('download-libHistXlsx')), findsNothing);
    expect(find.byKey(const Key('view-libHistPdf')), findsNothing);
    await tab(tester, 'find');
    expect(find.text('No book found.'), findsOneWidget);
    expect(t.calls.where((c) => c.method != 'GET'), isEmpty);
  });

  testWidgets('an account not linked to the child: the website\'s line, no library calls', (
    tester,
  ) async {
    final t = await pumpLibrary(tester, Lib(), profile: unlinked);
    expect(
      find.text('Your account is not linked to a student yet. Please contact the school office.'),
      findsOneWidget,
    );
    expect(t.calls.where((c) => c.path.startsWith('/library')), isEmpty);
    // the API saying the child is not this family's
    await tester.pumpWidget(const SizedBox());
    await pumpLibrary(tester, Lib(missing: true));
    expect(
      find.text('Your account is not linked to a student yet. Please contact the school office.'),
      findsOneWidget,
    );
  });

  for (final hindi in [false, true]) {
    testWidgets('large text (2×${hindi ? ', Hindi' : ''}): nothing overflows on the page, the open '
        'history or Find a book', (tester) async {
      await tester.binding.setSurfaceSize(const Size(360, 780));
      addTearDown(() => tester.binding.setSurfaceSize(null));
      await pumpLibrary(tester, Lib(), scale: 2, hindi: hindi);
      expect(tester.takeException(), isNull);
      final list = find.byType(ListView).first;
      final scroller = find.descendant(of: list, matching: find.byType(Scrollable)).first;
      await tester.scrollUntilVisible(
        find.byKey(const Key('libFigRead')),
        300,
        scrollable: scroller,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('libFigRead')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      await tester.dragUntilVisible(
        find.byKey(const Key('libHistSearch')),
        find.byType(ListView).first,
        const Offset(0, -300),
      );
      expect(find.byKey(const Key('libHistSearch')), findsOneWidget);
      for (var i = 0; i < 25; i++) {
        await tester.drag(list, const Offset(0, -500));
        await tester.pumpAndSettle();
      }
      expect(tester.takeException(), isNull);
      await tester.scrollUntilVisible(
        find.byKey(const Key('libTab-find')),
        -300,
        scrollable: find
            .descendant(of: find.byType(ListView).first, matching: find.byType(Scrollable))
            .first,
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('libTab-find')));
      await tester.pumpAndSettle();
      await tester.dragUntilVisible(
        find.byKey(const Key('libCatSearch')),
        find.byType(ListView).first,
        const Offset(0, -300),
      );
      expect(find.byKey(const Key('libCatSearch')), findsOneWidget);
      final cat = find.byType(ListView).first;
      for (var i = 0; i < 12; i++) {
        await tester.drag(cat, const Offset(0, -500));
        await tester.pumpAndSettle();
      }
      expect(tester.takeException(), isNull);
    });
  }

  for (final (dark, hindi) in [(false, false), (true, false), (false, true)]) {
    testWidgets('accessibility (${dark ? 'dark' : 'light'}${hindi ? ', Hindi' : ''}): tap targets, '
        'labelled controls and text contrast', (tester) async {
      await tall(tester);
      final handle = tester.ensureSemantics();
      await pumpLibrary(tester, Lib(), dark: dark, hindi: hindi);
      final w = S(hindi);
      Future<void> check(String where) async {
        await tester.pumpAndSettle();
        for (final g in [
          androidTapTargetGuideline,
          iOSTapTargetGuideline,
          labeledTapTargetGuideline,
          textContrastGuideline,
        ]) {
          await expectLater(tester, meetsGuideline(g), reason: '$where: ${g.description}');
        }
      }

      await check('the library page');
      await tab(tester, 'reservations');
      await check('the reservations');
      await tab(tester, 'history');
      expect(find.text(w.libHistoryFold(3)), findsOneWidget);
      expect(find.byKey(const Key('libHistSearch')), findsOneWidget);
      await check('the history');
      await tab(tester, 'digital');
      await check('the digital library');
      await tab(tester, 'find');
      expect(find.byKey(const Key('libReserve-t9')), findsOneWidget);
      await check('Find a book');
      handle.dispose();
    });
  }
}
