import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/family/assistant.dart';
import 'package:edupro/family/common.dart';
import 'package:edupro/family/help.dart';
import 'package:edupro/family/attendance.dart' show AttendanceScreen;
import 'package:edupro/family/results.dart' show ResultsScreen;
import 'package:edupro/family/profile.dart' show ProfileScreen;
import 'package:edupro/staff/my_leave.dart' show MyLeaveScreen;
import 'package:edupro/profiles/profiles.dart';
import 'package:edupro/theme/theme.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fakes.dart';

const parent = Profile(
  id: 'parent:7:41',
  kind: 'parent',
  schoolId: '7',
  schoolName: 'Sample School',
  name: 'Kid Sample',
  app: 'parent',
  studentId: '41',
);
const student = Profile(
  id: 'student:7:41',
  kind: 'student',
  schoolId: '7',
  schoolName: 'Sample School',
  name: 'Kid Sample',
  app: 'parent',
  studentId: '41',
);
const staff = Profile(
  id: 'staff:7',
  kind: 'staff',
  schoolId: '7',
  schoolName: 'Sample School',
  name: 'Asha Teacher',
  app: 'teacher',
);

Map<String, Object?> profileJson(Profile p) => {
  'id': p.id,
  'kind': p.kind,
  'schoolId': p.schoolId,
  'schoolCode': 'SAMPLE',
  'schoolName': p.schoolName,
  'name': p.name,
  'detail': 'VI-A · A1234',
  'studentId': p.studentId,
  'app': p.app,
  'actingAs': null,
  'hasPhoto': false,
};

Map<String, Object?> item(String href, String label) => {
  'href': href,
  'label': label,
  'help': null,
  'icon': 'users',
};

/// What the fake API answers: the assistant (open, closed to the person, or waiting for the consent) and the menu.
class School {
  School({this.kind = 'parent', this.mode = 'ok'});
  final String kind;

  /// ok · blocked (403: not open to the person) · consent (the start says the consent is missing) · withdrawn (the
  /// start says granted, asking says it is missing) · off (switched off for the audience) · limit (today's questions
  /// used up at the start) · overLimit (asking says so)
  final String mode;

  /// questions asked today
  int asked = 0;

  /// the school's name for the assistant
  String name = 'MobiAI';

  /// what was shown with an answer (docs/design/91): by a word of the question
  Map<String, Object?>? display(String q) {
    final w = q.toLowerCase();
    if (w.contains('attendance record') || w.contains('उपस्थिति')) {
      return {
        'card': {
          'kind': 'figures',
          'figures': [
            {'label': 'School days', 'labelHi': 'विद्यालय दिवस', 'value': '5'},
            {'label': 'Present', 'labelHi': 'उपस्थित', 'value': '4'},
            {'label': 'Absent', 'labelHi': 'अनुपस्थित', 'value': '1'},
            {'label': 'Absent on', 'labelHi': 'अनुपस्थित तिथि', 'value': '18 Nov'},
          ],
        },
        'link': {
          'label': 'Attendance',
          'labelHi': 'उपस्थिति',
          'app': '/attendance',
          'web': '/attendance',
        },
        'followUps': [
          {'id': 'child_homework', 'question': 'Homework this week'},
          {'id': 'child_dues', 'question': 'How much fees is due?'},
        ],
        'didYouMean': [],
        'suggestions': [],
      };
    }
    if (w.contains('receipts')) {
      return {
        'card': {
          'kind': 'table',
          'columns': [
            {'key': 'receipt_no', 'label': 'Receipt', 'labelHi': 'रसीद', 'type': 'text'},
            {'key': 'paid_on', 'label': 'Paid on', 'labelHi': 'भुगतान तिथि', 'type': 'date'},
            {'key': 'amount', 'label': 'Amount', 'labelHi': 'राशि', 'type': 'money'},
          ],
          'rows': [
            {'receipt_no': 'R-101', 'paid_on': '2026-11-02', 'amount': '1200.00'},
            {'receipt_no': 'R-087', 'paid_on': '2026-10-03', 'amount': '25000'},
          ],
          'more': 3,
        },
        // a screen the person's menu does not have, and no web page: no button
        'link': {'label': 'Library', 'labelHi': 'पुस्तकालय', 'app': '/library', 'web': null},
        'followUps': [],
        'didYouMean': [],
        'suggestions': [],
      };
    }
    if (w.contains('ravi')) {
      return {
        'card': null,
        'link': null,
        'followUps': [],
        'didYouMean': [
          {'id': 'child_attendance', 'question': 'Show the attendance record'},
          {'id': 'child_results', 'question': 'Show the results'},
        ],
        'suggestions': [],
      };
    }
    if (w.contains('blorp')) {
      // a question EduPro's rules could not place, answered with Claude's help (docs/design/93)
      return {
        'card': null,
        'link': null,
        'followUps': [],
        'didYouMean': [],
        'suggestions': [],
        'by': 'claude',
      };
    }
    if (w.contains('xyzzy')) {
      return {
        'card': null,
        'link': null,
        'followUps': [],
        'didYouMean': [],
        'suggestions': [
          {'id': 'child_dues', 'title': 'Fees due', 'question': 'How much fees is due?'},
        ],
      };
    }
    if (w.contains('leave')) {
      return {
        'card': {
          'kind': 'figures',
          'figures': [
            {'label': 'Casual leave left', 'labelHi': 'शेष आकस्मिक अवकाश', 'value': '6'},
            {'label': 'Earned leave left', 'labelHi': 'शेष अर्जित अवकाश', 'value': '12'},
          ],
        },
        'link': {
          'label': 'My leave',
          'labelHi': 'मेरा अवकाश',
          'app': '/my-leave',
          'web': '/my-leave',
        },
        'followUps': [],
        'didYouMean': [],
        'suggestions': [],
      };
    }
    return null;
  }

  /// The school's Help (empty: the school has none); votes given here.
  List<Map<String, Object?>> help = [
    {
      'id': '1',
      'title': 'Attendance and leave',
      'titleHi': 'उपस्थिति और अवकाश',
      'questions': [
        {
          'id': '2',
          'question': 'How do I apply for leave?',
          'questionHi': 'अवकाश के लिए आवेदन कैसे करूँ?',
          'answer': 'Attendance → Apply for leave, with the dates and the reason.',
          'answerHi': 'उपस्थिति → अवकाश के लिए आवेदन करें, तिथियाँ और कारण सहित।',
          'page': '/attendance',
          'pageLabel': 'Attendance',
          'myVote': null,
        },
        {
          'id': '3',
          'question': 'Why did I not get an absence alert?',
          'questionHi': null,
          'answer': 'Alerts go once a day per child after the attendance time.',
          'answerHi': null,
          'page': null,
          'pageLabel': null,
          'myVote': true,
        },
      ],
    },
    {
      'id': '4',
      'title': 'Results',
      'titleHi': 'परिणाम',
      'questions': [
        {
          'id': '5',
          'question': 'Where is the report card?',
          'questionHi': 'रिपोर्ट कार्ड कहाँ है?',
          'answer': 'Results shows each released term; the PDF button prepares the card.',
          'answerHi': 'परिणाम हर जारी सत्र दिखाता है; PDF बटन कार्ड तैयार करता है।',
          'page': '/results',
          'pageLabel': 'Results',
          'myVote': null,
        },
      ],
    },
    {
      'id': null,
      'title': 'Other questions',
      'titleHi': 'अन्य प्रश्न',
      'questions': [
        {
          'id': '6',
          'question': 'When does the bus leave?',
          'questionHi': null,
          'answer': 'At 7:10 from the first stop.',
          'answerHi': null,
          'page': null,
          'pageLabel': null,
          'myVote': null,
        },
      ],
    },
  ];
  final Map<String, bool> votes = {};
  final Map<String, List<Map<String, Object?>>> messages = {
    'c-1': [
      {'id': '1', 'role': 'user', 'content': 'Fees due?', 'refused': false, 'citations': []},
      {
        'id': '2',
        'role': 'assistant',
        'content': 'Rs 1,200 is due for Kid Sample.',
        'refused': false,
        'citations': [
          {'query': 'fees_due', 'title': 'Fees due', 'rows': 1},
        ],
      },
    ],
  };

  dynamic answer(Call c) {
    final key = '${c.method} ${c.path}';
    switch (key) {
      case 'GET /me/profiles':
        return {
          'data': [profileJson(kind == 'parent' ? parent : (kind == 'staff' ? staff : student))],
        };
      case 'GET /me/menu':
        if (kind == 'staff') {
          return {
            'app': 'teacher',
            'groups': [
              {
                'label': 'Me',
                'icon': 'users',
                'items': [item('/my-leave', 'My leave'), item('/assistant', 'Assistant')],
              },
            ],
          };
        }
        return {
          'app': 'parent',
          'groups': [
            {
              'label': 'My child',
              'icon': 'users',
              'items': [
                item('/profile', 'Profile'),
                item('/attendance', 'Attendance'),
                item('/results', 'Results'),
                item('/fees', 'Dues and receipts'),
                if (kind == 'parent') item('/appointments', 'Appointments'),
                item('/assistant', 'Assistant'),
                item('/help', 'Help'),
              ],
            },
          ],
        };
      case 'GET /insights/assistant/start':
        if (mode == 'blocked') throw const ApiException(403, 'forbidden', 'Not allowed');
        return {
          'audience': kind == 'staff' ? 'teacher' : kind,
          'on': mode != 'off',
          'consent': kind == 'staff'
              ? null
              : mode == 'consent'
              ? (kind == 'student' ? 'ask_parent' : 'needed')
              : 'granted',
          'dailyLimit': 30,
          'askedToday': mode == 'limit' ? 30 : asked,
          'starters': kind == 'staff'
              ? [
                  {
                    'id': 'my_leave_balance',
                    'question': 'My leave balance',
                    'questionHi': 'मेरा अवकाश शेष',
                  },
                ]
              : [
                  {
                    'id': 'child_attendance',
                    'question': 'Show the attendance record',
                    'questionHi': 'उपस्थिति रिकॉर्ड दिखाओ',
                  },
                  {
                    'id': 'child_receipts',
                    'question': 'Show the receipts',
                    'questionHi': 'रसीदें दिखाओ',
                  },
                ],
          'recent': [
            {'question': 'Fees due?'},
          ],
          // the chat window (docs/design/92)
          'name': name,
          'subtitle': kind == 'staff'
              ? 'Your smart teaching assistant'
              : kind == 'student'
              ? 'Your smart study assistant'
              : 'Your smart parent assistant',
          'subtitleHi': kind == 'staff'
              ? 'आपका स्मार्ट शिक्षण सहायक'
              : kind == 'student'
              ? 'आपका स्मार्ट पढ़ाई सहायक'
              : 'आपका स्मार्ट अभिभावक सहायक',
          'firstName': kind == 'staff' ? 'Asha' : 'Mina',
          'topics': kind == 'staff'
              ? [
                  {
                    'key': 'hr',
                    'label': 'Staff and HR',
                    'labelHi': 'कर्मचारी और HR',
                    'id': 'my_leave_balance',
                    'question': 'My leave balance',
                    'questionHi': 'मेरा अवकाश शेष',
                  },
                ]
              : [
                  {
                    'key': 'attendance',
                    'label': 'Attendance',
                    'labelHi': 'उपस्थिति',
                    'id': 'child_attendance',
                    'question': 'Show the attendance record',
                    'questionHi': 'उपस्थिति रिकॉर्ड दिखाओ',
                  },
                  {
                    'key': 'fees',
                    'label': 'Fees',
                    'labelHi': 'शुल्क',
                    'id': 'child_receipts',
                    'question': 'Show the receipts',
                    'questionHi': 'रसीदें दिखाओ',
                  },
                ],
          'quick': mode == 'consent' || mode == 'off'
              ? []
              : [
                  {
                    'id': 'child_attendance',
                    'topic': 'attendance',
                    'text': 'Kid Sample: present 4 of 5 days (80%), absent 1.',
                    'textHi': 'Kid Sample: 5 में से 4 दिन उपस्थित (80%), 1 अनुपस्थित।',
                    'question': 'Show the attendance record',
                    'questionHi': 'उपस्थिति रिकॉर्ड दिखाओ',
                  },
                ],
        };
      case 'GET /insights/assistant/catalogue':
        if (mode == 'blocked') throw const ApiException(403, 'forbidden', 'Not allowed');
        return {
          'data': [
            {
              'id': 'fees_due',
              'title': 'Fees due',
              'titleHi': 'बकाया शुल्क',
              'description': 'What is due for your child',
              'allowed': true,
            },
            {
              'id': 'staff_only',
              'title': 'Staff on leave',
              'titleHi': 'अवकाश पर कर्मचारी',
              'description': 'Not for families',
              'allowed': false,
            },
          ],
        };
      case 'GET /insights/assistant/conversations':
        if (mode == 'blocked') throw const ApiException(403, 'forbidden', 'Not allowed');
        return {
          'data': [
            for (final id in messages.keys.toList().reversed)
              {
                'id': id,
                'title': messages[id]!.first['content'],
                'turns': messages[id]!.length ~/ 2,
                'updatedAt': DateTime.now().toUtc().toIso8601String(),
              },
          ],
        };
      case 'POST /insights/assistant':
        if (mode == 'withdrawn' || mode == 'consent') {
          throw const ApiException(
            403,
            'consent-required',
            'Turn on the AI assistant consent in your profile to ask questions',
          );
        }
        if (mode == 'overLimit') {
          throw const ApiException(
            429,
            'ai.daily_limit',
            'You have asked 30 questions today, the most this school allows; try again tomorrow',
          );
        }
        final b = c.body!;
        asked++;
        final id = (b['conversationId'] as String?) ?? 'c-${messages.length + 1}';
        final answer = 'Answer ${(messages[id]?.length ?? 0) ~/ 2 + 1}: nothing is due.';
        messages.putIfAbsent(id, () => []).addAll([
          {'role': 'user', 'content': b['question'], 'refused': false, 'citations': []},
          {
            'role': 'assistant',
            'content': answer,
            'refused': false,
            'citations': [
              {'query': 'fees_due', 'title': 'Fees due', 'rows': 0},
            ],
            'display': display('${b['question']}'),
          },
        ]);
        return {
          'conversationId': id,
          'answer': answer,
          'refused': false,
          'citations': [],
          'suggestions': [],
        };
    }
    final conv = RegExp(r'^GET /insights/assistant/conversations/(.+)$').firstMatch(key);
    if (conv != null) {
      final m = messages[conv.group(1)];
      if (m == null) throw const ApiException(404, 'not-found', 'Conversation not found');
      return {'id': conv.group(1), 'title': m.first['content'], 'messages': m};
    }
    if (key == 'GET /engagement/help') {
      final student = c.query?['for'] == 'student';
      return {
        'audience': student ? 'student' : 'parent',
        'groups': [
          for (final g in help)
            if (!student || g['id'] != null)
              {
                ...g,
                'questions': (g['questions'] as List)
                    .map((q) => {...q as Map, 'myVote': votes[q['id']] ?? q['myVote']})
                    .toList(),
              },
        ],
      };
    }
    final vote = RegExp(r'^POST /engagement/help/(\d+)/vote$').firstMatch(key);
    if (vote != null) {
      votes[vote.group(1)!] = c.body!['helpful'] as bool;
      return {'ok': true, 'helpful': c.body!['helpful']};
    }
    throw ApiException(404, 'not-found', 'no fake for $key');
  }
}

Future<FakeTransport> pump(
  WidgetTester tester,
  Widget child, {
  School? school,
  bool hindi = false,
  bool dark = false,
  double text = 1,
}) async {
  SharedPreferences.setMockInitialValues({'hindi': hindi});
  final t = FakeTransport((school ?? School()).answer);
  await tester.pumpWidget(
    ProviderScope(
      key: UniqueKey(),
      overrides: [transportProvider.overrideWithValue(t)],
      child: MaterialApp(
        theme: eduproTheme(brightness: Brightness.light, webFonts: false),
        darkTheme: eduproTheme(brightness: Brightness.dark, webFonts: false),
        themeMode: dark ? ThemeMode.dark : ThemeMode.light,
        builder: (context, w) => MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(text)),
          child: w!,
        ),
        // the assistant is a chat window of its own (docs/design/92); Help sits in the family page
        home: child is AssistantScreen
            ? Scaffold(body: SafeArea(child: child))
            : FamilyPage(title: 'Assistant', child: child),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return t;
}

Future<void> tall(WidgetTester tester, [Size size = const Size(420, 2400)]) async {
  tester.view.devicePixelRatio = 3;
  tester.view.physicalSize = size * 3;
  addTearDown(tester.view.reset);
}

Future<void> tapIn(WidgetTester tester, Finder f) async {
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
  await tester.tap(f);
  await tester.pumpAndSettle();
}

List<Call> asks(FakeTransport t) =>
    t.calls.where((c) => c.method == 'POST' && c.path == '/insights/assistant').toList();

void main() {
  group('Assistant in the app: the MobiAI chat (no web page)', () {
    testWidgets('the window: name, subtitle, greeting, Quick Update, topics, footer', (
      tester,
    ) async {
      await tall(tester);
      await pump(tester, const AssistantScreen(profile: parent));
      expect(find.byKey(const Key('asstName')), findsOneWidget);
      expect(find.text('MobiAI'), findsOneWidget);
      expect(find.text('Your smart parent assistant'), findsOneWidget);
      expect(find.text('Today'), findsOneWidget);
      expect(
        find.textContaining('Mina! I’m MobiAI. Ask me about attendance, fees'),
        findsOneWidget,
      );
      expect(find.text('Try asking'), findsOneWidget);
      expect(find.text('Your Quick Update'), findsOneWidget);
      expect(find.text('Kid Sample: present 4 of 5 days (80%), absent 1.'), findsOneWidget);
      expect(find.byKey(const Key('asstTopic-attendance')), findsOneWidget);
      expect(find.byKey(const Key('asstTopic-fees')), findsOneWidget);
      expect(find.textContaining('Mobilise App Lab Limited', findRichText: true), findsOneWidget);
      // the school's name for it
      await pump(tester, const AssistantScreen(profile: parent), school: School()..name = 'Vidya');
      expect(find.text('Vidya'), findsOneWidget);
      expect(find.textContaining('I’m Vidya.'), findsOneWidget);
    });

    testWidgets('a starter asks; the answer with figures, its time, Open and Ask next', (
      tester,
    ) async {
      await tall(tester);
      final t = await pump(tester, const AssistantScreen(profile: parent));
      await tapIn(tester, find.byKey(const Key('asstStarters-0')));
      expect(asks(t).single.body, {'question': 'Show the attendance record', 'surface': 'parent'});
      expect(find.text('Show the attendance record'), findsOneWidget);
      expect(find.byKey(const Key('asstFigures-c-2')), findsOneWidget);
      expect(find.text('School days'), findsOneWidget);
      expect(find.text('Open Attendance'), findsOneWidget);
      expect(find.text('Ask next'), findsOneWidget);
      expect(find.textContaining(RegExp(r'^\d\d:\d\d (am|pm)$')), findsWidgets);
      // the starters are for the start
      expect(find.text('Try asking'), findsNothing);

      await tapIn(tester, find.byKey(const Key('asstNext-0')));
      expect(asks(t).last.body, {
        'question': 'Homework this week',
        'conversationId': 'c-2',
        'surface': 'parent',
      });
      expect(find.text('Answer 2: nothing is due.'), findsOneWidget);
      // what to ask next goes with the latest answer only
      expect(find.byKey(const Key('asstNext')), findsNothing);

      await tapIn(tester, find.text('Open Attendance'));
      expect(find.byType(AttendanceScreen), findsOneWidget);
    });

    testWidgets('a topic asks its question; a typed question goes on in the conversation', (
      tester,
    ) async {
      await tall(tester);
      final t = await pump(tester, const AssistantScreen(profile: parent));
      await tapIn(tester, find.byKey(const Key('asstTopic-fees')));
      expect(asks(t).single.body!['question'], 'Show the receipts');
      expect(find.byKey(const Key('asstTable')), findsOneWidget);
      expect(find.text('R-101'), findsOneWidget);
      expect(find.text('₹1,200'), findsOneWidget);
      expect(find.text('2 Nov 2026'), findsOneWidget);
      expect(find.text('and 3 more'), findsOneWidget);
      // a screen the person's menu does not have, and no web page: no button
      expect(find.text('Open Library'), findsNothing);

      await tapIn(tester, find.byKey(const Key('asstAsk')));
      expect(find.text('Write a question (at least 2 letters).'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('asstQuestion')), '  Kitni fees baki hai?  ');
      await tapIn(tester, find.byKey(const Key('asstAsk')));
      expect(asks(t).last.body, {
        'question': 'Kitni fees baki hai?',
        'conversationId': 'c-2',
        'surface': 'parent',
      });
      expect(find.text('Kitni fees baki hai?'), findsOneWidget);
      expect(tester.widget<TextField>(find.byKey(const Key('asstQuestion'))).controller!.text, '');
    });

    testWidgets('“did you mean” and, for what it cannot answer, what may be asked instead', (
      tester,
    ) async {
      await tall(tester);
      final t = await pump(tester, const AssistantScreen(profile: parent));
      await tester.enterText(find.byKey(const Key('asstQuestion')), 'what about ravi');
      await tapIn(tester, find.byKey(const Key('asstAsk')));
      expect(find.text('Did you mean'), findsOneWidget);
      expect(find.text('Show the results'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('asstQuestion')), 'xyzzy plugh');
      await tapIn(tester, find.byKey(const Key('asstAsk')));
      expect(find.text('Did you mean'), findsNothing);
      expect(find.text('You can ask'), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('asstInstead-0')));
      expect(asks(t).last.body!['question'], 'How much fees is due?');
    });

    testWidgets('an answer written with Claude’s help says so; EduPro’s own do not', (
      tester,
    ) async {
      await tall(tester);
      await pump(
        tester,
        const AssistantScreen(profile: staff),
        school: School(kind: 'staff'),
      );
      await tester.enterText(find.byKey(const Key('asstQuestion')), 'blorp frumble');
      await tapIn(tester, find.byKey(const Key('asstAsk')));
      expect(find.text('Answered with Claude'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('asstQuestion')), 'my leave balance');
      await tapIn(tester, find.byKey(const Key('asstAsk')));
      expect(find.text('Answered with Claude'), findsOneWidget);
      // in Hindi
      await pump(
        tester,
        const AssistantScreen(profile: staff),
        school: School(kind: 'staff'),
        hindi: true,
      );
      await tester.enterText(find.byKey(const Key('asstQuestion')), 'blorp');
      await tapIn(tester, find.byKey(const Key('asstAsk')));
      expect(find.text('Claude की सहायता से उत्तर'), findsOneWidget);
    });

    testWidgets('earlier conversations open from the header; the bin starts afresh', (
      tester,
    ) async {
      await tall(tester);
      await pump(tester, const AssistantScreen(profile: parent));
      await tapIn(tester, find.byKey(const Key('asstEarlierBtn')));
      expect(find.byKey(const Key('asstEarlier')), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('asstConv-c-1')));
      expect(find.text('Rs 1,200 is due for Kid Sample.'), findsOneWidget);
      expect(find.text('Source: Fees due'), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('asstNew')));
      expect(find.text('Rs 1,200 is due for Kid Sample.'), findsNothing);
      expect(find.text('Try asking'), findsOneWidget);
    });

    testWidgets('opened over the app: Close goes back', (tester) async {
      await tall(tester);
      SharedPreferences.setMockInitialValues({});
      final t = FakeTransport(School().answer);
      await tester.pumpWidget(
        ProviderScope(
          overrides: [transportProvider.overrideWithValue(t)],
          child: MaterialApp(
            theme: eduproTheme(brightness: Brightness.light, webFonts: false),
            home: Builder(
              builder: (c) => Scaffold(
                body: Center(
                  child: TextButton(
                    onPressed: () => openAssistant(c, parent),
                    child: const Text('open'),
                  ),
                ),
              ),
            ),
          ),
        ),
      );
      await tapIn(tester, find.text('open'));
      expect(find.byType(AssistantScreen), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('asstClose')));
      expect(find.byType(AssistantScreen), findsNothing);
    });

    testWidgets('a parent without the consent: says so and opens the profile; no Quick Update', (
      tester,
    ) async {
      await tall(tester);
      final t = await pump(
        tester,
        const AssistantScreen(profile: parent),
        school: School(mode: 'consent'),
      );
      expect(find.byKey(const Key('asstConsent')), findsOneWidget);
      expect(find.byKey(const Key('asstQuestion')), findsNothing);
      expect(find.byKey(const Key('asstQuick')), findsNothing);
      expect(find.byKey(const Key('asstTopics')), findsNothing);
      await tapIn(tester, find.byKey(const Key('asstOpenProfile')));
      expect(find.byType(ProfileScreen), findsOneWidget);
      final before = t.calls.where((c) => c.path == '/insights/assistant/start').length;
      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(t.calls.where((c) => c.path == '/insights/assistant/start').length, before + 1);
    });

    testWidgets('a consent withdrawn meanwhile: asking says so', (tester) async {
      await tall(tester);
      await pump(
        tester,
        const AssistantScreen(profile: parent),
        school: School(mode: 'withdrawn'),
      );
      await tester.enterText(find.byKey(const Key('asstQuestion')), 'Fees due?');
      await tapIn(tester, find.byKey(const Key('asstAsk')));
      expect(find.byKey(const Key('asstConsent')), findsOneWidget);
      expect(find.byKey(const Key('asstQuestion')), findsNothing);
    });

    testWidgets('a student: ask a parent first; with the consent, their own', (tester) async {
      await tall(tester);
      await pump(
        tester,
        const AssistantScreen(profile: student),
        school: School(kind: 'student', mode: 'consent'),
      );
      expect(find.text('Your smart study assistant'), findsOneWidget);
      expect(find.byKey(const Key('asstAskParent')), findsOneWidget);
      expect(find.byKey(const Key('asstOpenProfile')), findsNothing);
      expect(find.byKey(const Key('asstQuestion')), findsNothing);
      final t = await pump(
        tester,
        const AssistantScreen(profile: student),
        school: School(kind: 'student'),
      );
      await tapIn(tester, find.byKey(const Key('asstStarters-0')));
      expect(asks(t).single.body!['surface'], 'parent');
      expect(find.text('School days'), findsOneWidget);
    });

    testWidgets('switched off; today’s questions used up (at the start or when asking)', (
      tester,
    ) async {
      await tall(tester);
      await pump(
        tester,
        const AssistantScreen(profile: parent),
        school: School(mode: 'off'),
      );
      expect(find.byKey(const Key('asstOff')), findsOneWidget);
      expect(find.byKey(const Key('asstQuestion')), findsNothing);
      await pump(
        tester,
        const AssistantScreen(profile: parent),
        school: School(mode: 'limit'),
      );
      expect(find.byKey(const Key('asstLimit')), findsOneWidget);
      expect(find.textContaining('asked 30 questions today'), findsOneWidget);
      expect(find.byKey(const Key('asstQuestion')), findsNothing);
      await pump(
        tester,
        const AssistantScreen(profile: parent),
        school: School(mode: 'overLimit'),
      );
      expect(find.byKey(const Key('asstLimit')), findsNothing);
      await tapIn(tester, find.byKey(const Key('asstStarters-0')));
      expect(find.byKey(const Key('asstLimit')), findsOneWidget);
      expect(find.byKey(const Key('asstAsk')), findsNothing);
    });

    testWidgets('staff ask as the teachers’ app and open their own screens', (tester) async {
      await tall(tester);
      final t = await pump(
        tester,
        const AssistantScreen(profile: staff),
        school: School(kind: 'staff'),
      );
      expect(find.text('Your smart teaching assistant'), findsOneWidget);
      expect(find.textContaining('Asha! I’m MobiAI. Ask me about staff and HR'), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('asstTopic-hr')));
      expect(asks(t).single.body, {'question': 'My leave balance', 'surface': 'teacher'});
      expect(find.text('Casual leave left'), findsOneWidget);
      await tapIn(tester, find.text('Open My leave'));
      expect(find.byType(MyLeaveScreen), findsOneWidget);
    });

    testWidgets('a person the assistant is not open to', (tester) async {
      await tall(tester);
      await pump(
        tester,
        const AssistantScreen(profile: parent),
        school: School(mode: 'blocked'),
      );
      expect(find.text('The assistant is not open to you at this school.'), findsOneWidget);
      expect(find.byKey(const Key('asstQuestion')), findsNothing);
    });

    testWidgets('in Hindi: the words, the Quick Update and the answer’s language', (tester) async {
      await tall(tester);
      final t = await pump(tester, const AssistantScreen(profile: parent), hindi: true);
      expect(find.text('आपका स्मार्ट अभिभावक सहायक'), findsOneWidget);
      expect(find.textContaining('मैं MobiAI हूँ। मुझसे पूछें: उपस्थिति, शुल्क'), findsOneWidget);
      expect(find.text('आपका त्वरित अपडेट'), findsOneWidget);
      expect(find.text('Kid Sample: 5 में से 4 दिन उपस्थित (80%), 1 अनुपस्थित।'), findsOneWidget);
      expect(find.text('ऐसे पूछें'), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('asstStarters-0')));
      expect(asks(t).single.body, {
        'question': 'उपस्थिति रिकॉर्ड दिखाओ',
        'language': 'hi',
        'surface': 'parent',
      });
      expect(find.text('विद्यालय दिवस'), findsOneWidget);
      expect(find.text('उपस्थिति खोलें'), findsOneWidget);
    });
  });

  group('Help in the app, as the school keeps it (no web page)', () {
    testWidgets('headings fold, then questions; the answer, its screen and “Was this helpful?”', (
      tester,
    ) async {
      await tall(tester);
      final t = await pump(tester, const HelpScreen(profile: parent));
      expect(t.calls.firstWhere((c) => c.path == '/engagement/help').query, {'for': 'parent'});
      expect(find.byKey(const Key('helpIntro')), findsOneWidget);
      expect(find.text('Attendance and leave'), findsOneWidget);
      expect(find.text('2 questions'), findsOneWidget);
      expect(find.text('Other questions'), findsOneWidget);
      expect(find.text('How do I apply for leave?'), findsNothing);

      await tapIn(tester, find.text('Attendance and leave'));
      expect(find.text('How do I apply for leave?'), findsOneWidget);
      expect(find.textContaining('Apply for leave, with the dates'), findsNothing);
      await tapIn(tester, find.text('How do I apply for leave?'));
      expect(find.textContaining('Apply for leave, with the dates'), findsOneWidget);
      expect(find.text('Open Attendance'), findsOneWidget);
      expect(find.text('Was this helpful?'), findsOneWidget);

      await tapIn(tester, find.byKey(const Key('helpYes-2')));
      final vote = t.calls.lastWhere((c) => c.method == 'POST');
      expect(vote.path, '/engagement/help/2/vote');
      expect(vote.body, {'helpful': true});
      expect(find.text('Thank you. You said this helped.'), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('helpNo-2')));
      expect(t.calls.lastWhere((c) => c.method == 'POST').body, {'helpful': false});
      expect(find.textContaining('You said this did not help'), findsOneWidget);

      // a vote the person gave before shows; an answer with no screen has no button
      await tapIn(tester, find.text('Why did I not get an absence alert?'));
      expect(find.byKey(const Key('helpThanks-3')), findsOneWidget);
      expect(find.byKey(const Key('helpOpen-3')), findsNothing);
    });

    testWidgets('the screen an answer is about opens in the app', (tester) async {
      await tall(tester);
      await pump(tester, const HelpScreen(profile: parent));
      await tapIn(tester, find.text('Results'));
      await tapIn(tester, find.text('Where is the report card?'));
      await tapIn(tester, find.byKey(const Key('helpOpen-5')));
      expect(find.byType(ResultsScreen), findsOneWidget);
    });

    testWidgets('the search opens the headings it finds something under', (tester) async {
      await tall(tester);
      await pump(tester, const HelpScreen(profile: parent));
      await tester.enterText(find.byKey(const Key('helpSearch')), 'report');
      await tester.pumpAndSettle();
      expect(find.text('1 question for “report”'), findsOneWidget);
      expect(find.text('Where is the report card?'), findsOneWidget);
      expect(find.text('Attendance and leave'), findsNothing);
      // the answers are searched too
      await tester.enterText(find.byKey(const Key('helpSearch')), '7:10');
      await tester.pumpAndSettle();
      expect(find.text('When does the bus leave?'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('helpSearch')), 'zzz');
      await tester.pumpAndSettle();
      expect(find.textContaining('Nothing matches your search'), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('helpClear')));
      expect(find.text('Attendance and leave'), findsOneWidget);
      expect(find.text('Where is the report card?'), findsNothing);
    });

    testWidgets('a student asks for the students’ questions', (tester) async {
      await tall(tester);
      final t = await pump(
        tester,
        const HelpScreen(profile: student),
        school: School(kind: 'student'),
      );
      expect(t.calls.firstWhere((c) => c.path == '/engagement/help').query, {'for': 'student'});
      expect(find.text('Other questions'), findsNothing);
    });

    testWidgets('a school with no questions', (tester) async {
      await tall(tester);
      await pump(tester, const HelpScreen(profile: parent), school: School()..help = []);
      expect(find.textContaining('No questions yet'), findsOneWidget);
      expect(find.byKey(const Key('helpSearch')), findsNothing);
    });

    testWidgets('in Hindi, with the English where the school wrote no Hindi', (tester) async {
      await tall(tester);
      await pump(tester, const HelpScreen(profile: parent), hindi: true);
      expect(find.text('उपस्थिति और अवकाश'), findsOneWidget);
      expect(find.text('2 प्रश्न'), findsOneWidget);
      await tapIn(tester, find.text('उपस्थिति और अवकाश'));
      await tapIn(tester, find.text('अवकाश के लिए आवेदन कैसे करूँ?'));
      expect(find.textContaining('तिथियाँ और कारण सहित'), findsOneWidget);
      expect(find.text('उपस्थिति खोलें'), findsOneWidget);
      expect(find.text('Why did I not get an absence alert?'), findsOneWidget);
    });
  });

  for (final (name, hindi, dark) in [
    ('light', false, false),
    ('dark', false, true),
    ('Hindi', true, false),
  ]) {
    testWidgets('accessibility ($name): the assistant with a conversation, and help', (
      tester,
    ) async {
      await tall(tester);
      final handle = tester.ensureSemantics();
      for (final w in [const AssistantScreen(profile: parent), const HelpScreen(profile: parent)]) {
        await pump(tester, w, hindi: hindi, dark: dark);
        if (w is AssistantScreen) {
          await tapIn(tester, find.byKey(const Key('asstStarters-0')));
        } else {
          await tapIn(tester, find.text(hindi ? 'उपस्थिति और अवकाश' : 'Attendance and leave'));
          await tapIn(tester, find.byKey(const Key('help-2')));
        }
        for (final g in [
          androidTapTargetGuideline,
          iOSTapTargetGuideline,
          labeledTapTargetGuideline,
          textContrastGuideline,
        ]) {
          await expectLater(
            tester,
            meetsGuideline(g),
            reason: '${w.runtimeType}: ${g.description}',
          );
        }
      }
      handle.dispose();
    });
  }

  testWidgets('large text (2×): nothing overflows', (tester) async {
    await tall(tester, const Size(390, 5200));
    await pump(tester, const AssistantScreen(profile: parent), text: 2);
    await tapIn(tester, find.byKey(const Key('asstStarters-0')));
    await tapIn(tester, find.byKey(const Key('asstNext-1')));
    await tapIn(tester, find.byKey(const Key('asstNew')));
    await tapIn(tester, find.byKey(const Key('asstStarters-1')));
    await tapIn(tester, find.byKey(const Key('asstEarlierBtn')));
    expect(tester.takeException(), isNull);
    await pump(
      tester,
      const AssistantScreen(profile: staff),
      school: School(kind: 'staff'),
      text: 2,
    );
    await tapIn(tester, find.byKey(const Key('asstStarters-0')));
    expect(tester.takeException(), isNull);
    await pump(tester, const HelpScreen(profile: parent), text: 2);
    await tapIn(tester, find.text('Attendance and leave'));
    await tapIn(tester, find.byKey(const Key('help-2')));
    await tester.enterText(find.byKey(const Key('helpSearch')), 'leave');
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}
