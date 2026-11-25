import 'dart:convert';

import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/family/attendance.dart' show leaveFilePickerProvider;
import 'package:edupro/family/common.dart';
import 'package:edupro/family/consents.dart';
import 'package:edupro/l10n/strings.dart';
import 'package:edupro/profiles/profiles.dart';
import 'package:edupro/staff/data.dart' show PickedFile;
import 'package:edupro/theme/theme.dart';
import 'package:edupro/ui/home_shell.dart' show nativeScreen;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fakes.dart';

const kid = Profile(
  id: 'parent:7:41',
  kind: 'parent',
  schoolId: '7',
  schoolName: 'Sample School',
  name: 'Kid Sample',
  app: 'parent',
  studentId: '41',
);

/// A day in India time (the forms' closing times are the school's wall clock), `YYYY-MM-DD`.
String istDay(int n) {
  final now = DateTime.now().toUtc().add(const Duration(minutes: 330));
  final d = DateTime.utc(now.year, now.month, now.day).add(Duration(days: n));
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

/// A day on the phone's own clock (what the date picker starts on), `YYYY-MM-DD`.
String day(int n) {
  final d = DateTime.now().add(Duration(days: n));
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

Map<String, Object?> rule(
  String action,
  String field,
  String op,
  String value, {
  String logic = 'all',
}) => {
  'logic': logic,
  'action': action,
  'conditions': [
    {'field': field, 'op': op, 'value': value},
  ],
};

/// The trip form: two steps, a rule that shows (and so requires) the lunch, another that shows the certificate.
final tripFields = <Map<String, Object?>>[
  {'key': 'going', 'label': 'Will your child go?', 'type': 'yesno', 'required': true},
  {
    'key': 'meal',
    'label': 'Lunch',
    'type': 'select',
    'required': true,
    'options': ['Veg', 'Non-veg'],
    'rule': rule('show', 'going', 'eq', 'true'),
  },
  {
    'key': 'tickets',
    'label': 'Extra tickets for parents',
    'type': 'number',
    'min': 0,
    'max': 4,
    'help': '150 each',
  },
  {'key': 'p2', 'label': 'Page 2', 'type': 'pagebreak'},
  {'key': 'health', 'label': 'Health', 'type': 'heading', 'help': 'Tell us about allergies'},
  {
    'key': 'allergy',
    'label': 'Allergies',
    'type': 'checkbox',
    'options': ['Peanuts', 'Dust'],
  },
  {
    'key': 'medical',
    'label': 'Medical certificate',
    'type': 'file',
    'required': true,
    'maxFiles': 2,
    'rule': rule('show', 'allergy', 'eq', 'Peanuts', logic: 'any'),
  },
  {'key': 'travel_on', 'label': 'Date of travel', 'type': 'date', 'required': true},
  {'key': 'sign', 'label': 'Parent signature', 'type': 'signature', 'required': true},
  {'key': 'ok', 'label': 'I agree to the rules of the trip', 'type': 'agree', 'required': true},
];

/// Every kind of question on one step (for the accessibility and large-text checks).
final everyFields = <Map<String, Object?>>[
  {'key': 'about', 'label': 'About the child', 'type': 'heading', 'help': 'As in the register'},
  {'key': 'nick', 'label': 'Name used at home', 'type': 'text', 'placeholder': 'Optional'},
  {'key': 'notes', 'label': 'Anything the teacher should know', 'type': 'textarea'},
  {'key': 'age', 'label': 'Age', 'type': 'number', 'required': true},
  {'key': 'mail', 'label': 'E-mail', 'type': 'email'},
  {'key': 'phone', 'label': 'Mobile for the day', 'type': 'phone'},
  {'key': 'when', 'label': 'Date of the visit', 'type': 'date'},
  {'key': 'at', 'label': 'Time of pick-up', 'type': 'time'},
  {'key': 'house', 'label': 'House', 'type': 'radio', 'source': 'houses'},
  {
    'key': 'size',
    'label': 'T-shirt size',
    'type': 'select',
    'options': ['S', 'M', 'L'],
  },
  {
    'key': 'games',
    'label': 'Games',
    'type': 'checkbox',
    'options': ['Chess', 'Relay race'],
  },
  {'key': 'photo', 'label': 'May the school take photos?', 'type': 'yesno'},
  {'key': 'doc', 'label': 'Doctor’s note', 'type': 'file'},
  {'key': 'sig', 'label': 'Signature', 'type': 'signature'},
  {'key': 'yes', 'label': 'I agree', 'type': 'agree', 'required': true},
];

/// A made-up school's consent forms (no real names).
class School {
  /// answers as a staff member (Forms and declarations)
  bool staff = false;
  List<Map<String, Object?>> gateways = [
    {'id': 'g1', 'label': 'Cards and UPI', 'chargePercent': '0', 'chargeFlat': '0'},
    {'id': 'g2', 'label': 'Net banking', 'chargePercent': '0', 'chargeFlat': '10.00'},
  ];

  /// no forms for the child yet
  bool none = false;

  Map<String, Object?> answer0(
    String id,
    String number,
    String status, {
    Map<String, Object?> more = const {},
  }) => {
    'id': id,
    'number': number,
    'signedAt': '${istDay(-1)}T05:00:00Z',
    'respondent': 'family',
    'status': status,
    'fee': '0.00',
    'lineId': null,
    'paid': null,
    'lineAmount': null,
    'waiting': false,
    'canEdit': false,
    'decidedNote': null,
    ...more,
  };

  Map<String, Object?> form(
    String id,
    String title, {
    bool open = true,
    String? closesAt,
    String feeMode = 'none',
    bool approval = false,
    String? description,
    String repeat = 'once',
    bool canAnswer = false,
    List<Map<String, Object?>> responses = const [],
    String child = '41',
  }) => {
    'id': id,
    'title': title,
    'description': description,
    'open': open,
    'closedWhy': open ? null : 'closed',
    'closesAt': closesAt,
    'editUntil': id == 'f1' ? '${istDay(5)}T18:00' : null,
    'repeat': repeat,
    'feeMode': feeMode,
    'approval': approval,
    'people': [
      {
        'kind': 'student',
        'id': child,
        'name': 'Kid Sample',
        'canAnswer': canAnswer,
        'responses': responses,
      },
      if (child == '41')
        {'kind': 'student', 'id': '42', 'name': 'Other Sample', 'canAnswer': true, 'responses': []},
    ],
  };

  List<Map<String, Object?>> forms() => none
      ? [form('f7', 'Hostel outing', canAnswer: true, child: '42')]
      : [
          form(
            'f1',
            'Science trip to the planetarium',
            closesAt: '${istDay(0)}T23:59',
            feeMode: 'calc',
            approval: true,
            description: 'The bus leaves at 8 am and comes back by 4 pm.',
            canAnswer: true,
          ),
          form(
            'f6',
            'Library card',
            repeat: 'many',
            canAnswer: true,
            responses: [answer0('r5', 'CF-0015', 'submitted')],
          ),
          form(
            'f2',
            'Photos at the annual day',
            closesAt: '${istDay(1)}T17:00',
            responses: [
              answer0('r1', 'CF-0012', 'submitted', more: {'canEdit': true}),
            ],
          ),
          form(
            'f3',
            'Sports kit order',
            closesAt: '${istDay(10)}T17:00',
            feeMode: 'fixed',
            approval: true,
            responses: [
              answer0(
                'r2',
                'CF-0013',
                'approved',
                more: {
                  'fee': '500.00',
                  'lineId': 'l7',
                  'paid': '200.00',
                  'lineAmount': '500.00',
                  'decidedNote': 'Size M noted',
                },
              ),
            ],
          ),
          form(
            'f5',
            'Swimming classes',
            feeMode: 'calc',
            approval: true,
            responses: [
              answer0(
                'r4',
                'CF-0014',
                'submitted',
                more: {'waiting': true, 'fee': '250.00', 'canEdit': true},
              ),
            ],
          ),
          form(
            'f4',
            'Picnic to the lake',
            open: false,
            closesAt: '${istDay(-3)}T17:00',
            feeMode: 'fixed',
            approval: true,
            responses: [
              answer0(
                'r3',
                'CF-0009',
                'rejected',
                more: {'fee': '300.00', 'decidedNote': 'No seats left'},
              ),
            ],
          ),
          // another child's form: not this child's
          form('f7', 'Hostel outing', canAnswer: true, child: '42'),
        ];

  Map<String, Object?> toFill(
    String id,
    String title,
    List<Map<String, Object?>> fields, {
    Map<String, Object?> fee = const {'mode': 'none', 'items': []},
    bool approval = false,
    bool open = true,
    String? closedWhy,
    bool canAnswer = true,
    List<Map<String, Object?>> responses = const [],
    Map<String, Object?>? editing,
    bool canEdit = false,
    String? description,
  }) => {
    'id': id,
    'title': title,
    'description': description,
    'fields': fields,
    'lists': {
      'houses': ['Red', 'Blue'],
    },
    'fee': fee,
    'approval': approval,
    'editUntil': '${istDay(5)}T18:00',
    'editing': editing,
    'canEdit': canEdit,
    'open': open,
    'closedWhy': closedWhy,
    'closesAt': '${istDay(0)}T23:59',
    'repeat': 'once',
    'about': {'id': '41', 'name': 'Kid Sample', 'section': 'VI-A'},
    'responses': responses,
    'canAnswer': canAnswer,
  };

  static const tripFee = {
    'mode': 'calc',
    'base': 200,
    'items': [
      {'field': 'tickets', 'rate': 150},
      {
        'field': 'meal',
        'prices': {'Non-veg': 50},
      },
    ],
  };

  Object? answer(Call c) {
    final q = c.query ?? const <String, Object?>{};
    switch ('${c.method} ${c.path}') {
      case 'GET /engagement/mine/consent-forms':
        // staff: the part asked of the staff member themself (the first person becomes "staff")
        final own = [
          for (final f in forms())
            {
              ...f,
              'people': [
                {
                  ...(f['people'] as List).first as Map<String, Object?>,
                  'kind': 'staff',
                  'id': 'e7',
                },
              ],
            },
        ];
        if (q['part'] == 'staff') return staffPage(own, q);
        return {
          'forms': staff ? own : forms(),
          'children': [
            {'id': '41', 'name': 'Kid Sample', 'section': 'VI-A'},
          ],
          'staff': false,
        };
      case 'GET /payments/gateways/options':
        return {'data': gateways};
      case 'GET /me':
        return {
          'user': {'id': 'u1', 'displayName': 'Parent Sample', 'mfa': false},
        };
      case 'GET /engagement/mine/consent-forms/f1':
        if (q['responseId'] == 'r9') {
          return toFill(
            'f1',
            'Science trip to the planetarium',
            tripFields,
            fee: tripFee,
            approval: true,
            description: 'The bus leaves at 8 am and comes back by 4 pm.',
            canAnswer: false,
            responses: [
              {'id': 'r9', 'number': 'CF-0021'},
            ],
            canEdit: true,
            editing: {
              'id': 'r9',
              'number': 'CF-0021',
              'answers': {
                'going': true,
                'meal': 'Veg',
                'tickets': 1,
                'allergy': ['Peanuts'],
                'medical': ['77'],
                'travel_on': '2026-11-25',
                'sign': true,
                'ok': true,
              },
              'signedName': 'Parent Sample',
              'signed': ['sign'],
            },
          );
        }
        return toFill(
          'f1',
          'Science trip to the planetarium',
          tripFields,
          fee: tripFee,
          approval: true,
          description: 'The bus leaves at 8 am and comes back by 4 pm.',
        );
      case 'GET /engagement/mine/consent-forms/f6':
        return toFill('f6', 'Library card', [
          {'key': 'keep', 'label': 'I will keep the card safe', 'type': 'agree', 'required': true},
        ]);
      case 'GET /engagement/mine/consent-forms/f2':
        final photo = [
          {
            'key': 'photo',
            'label': 'May the school publish photos?',
            'type': 'yesno',
            'required': true,
          },
        ];
        return q['responseId'] == 'r1'
            ? toFill(
                'f2',
                'Photos at the annual day',
                photo,
                canAnswer: false,
                canEdit: true,
                editing: {
                  'id': 'r1',
                  'number': 'CF-0012',
                  'answers': {'photo': false},
                  'signedName': null,
                  'signed': null,
                },
              )
            : toFill(
                'f2',
                'Photos at the annual day',
                photo,
                canAnswer: false,
                responses: [
                  {'id': 'r1', 'number': 'CF-0012'},
                ],
              );
      case 'GET /engagement/mine/consent-forms/f3':
        return toFill(
          'f3',
          'Sports kit order',
          [
            {'key': 'size', 'label': 'Size', 'type': 'text'},
          ],
          canAnswer: false,
          editing: {
            'id': 'r2',
            'number': 'CF-0013',
            'answers': {'size': 'M'},
            'signedName': 'Parent Sample',
            'signed': null,
          },
        );
      case 'GET /engagement/mine/consent-forms/f4':
        return toFill(
          'f4',
          'Picnic to the lake',
          const [],
          open: false,
          closedWhy: 'all places are taken',
          canAnswer: false,
        );
      case 'GET /engagement/mine/consent-forms/f9':
        return toFill(
          'f9',
          'School visit day',
          everyFields,
          fee: const {'mode': 'fixed', 'amount': 120, 'items': []},
          description: 'Parents may come to the school on the visit day. Please tell us who comes.',
        );
      case 'POST /engagement/mine/consent-forms/f1/responses':
        return {
          'id': 'r20',
          'number': 'CF-0020',
          'success': null,
          'title': 'Trip',
          'fee': 700,
          'waiting': true,
        };
      case 'POST /engagement/mine/consent-forms/f6/responses':
        return {
          'id': 'r30',
          'number': 'CF-0030',
          'success': 'Collect the card from the library.',
          'title': 'Library card',
          'fee': 0,
          'waiting': false,
        };
      case 'PUT /engagement/mine/consent-forms/responses/r9':
        return {'id': 'r9', 'number': 'CF-0021', 'fee': 500};
      case 'PUT /engagement/mine/consent-forms/responses/r1':
        return {'id': 'r1', 'number': 'CF-0012', 'fee': 0};
      case 'GET /engagement/mine/consent-forms/responses/r1/pdf':
      case 'GET /engagement/mine/consent-forms/responses/r2/pdf':
        return const ApiFile(
          bytes: [37, 80, 68, 70],
          contentType: 'application/pdf',
          name: 'cf.pdf',
        );
      case 'POST /platform/files':
        return {
          'file': {'id': '55'},
          'upload': {'url': '/upload/55', 'method': 'PUT'},
        };
      case 'PUT /upload/55':
        return null;
      case 'POST /platform/files/55/complete':
        return {'ok': true};
      case 'POST /payments/intents/mine/misc':
        return {
          'intent': {
            'id': 'i9',
            'txnId': 'TXN9',
            'amount': '300.00',
            'returnUrl': 'https://parent.example.test/api/payments/mobile-done?student=41',
          },
          'checkout': {
            'kind': 'form',
            'provider': 'mock',
            'mode': 'mock',
            'action': '/api/v1/payments/payu/mock',
            'method': 'POST',
            'fields': <String, String>{},
          },
        };
      case 'POST /payments/payu/mock':
        return c.body!['outcome'] == 'success'
            ? {'outcome': 'applied', 'status': 'succeeded'}
            : {'outcome': 'failed', 'status': 'failed'};
    }
    throw ApiException(404, 'not-found', 'no fake for ${c.method} ${c.path}');
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
      // a fresh scope each time: the language, the fakes and the data of this pump only
      key: UniqueKey(),
      overrides: [
        transportProvider.overrideWithValue(t),
        leaveFilePickerProvider.overrideWithValue(
          () async => const [
            PickedFile(
              name: 'allergy.pdf',
              bytes: [37, 80, 68, 70],
              contentType: 'application/pdf',
            ),
          ],
        ),
      ],
      child: MaterialApp(
        theme: eduproTheme(brightness: Brightness.light, webFonts: false),
        darkTheme: eduproTheme(brightness: Brightness.dark, webFonts: false),
        themeMode: dark ? ThemeMode.dark : ThemeMode.light,
        builder: (context, w) => MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(text)),
          child: w!,
        ),
        home: FamilyPage(title: 'Consent forms', child: child),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return t;
}

/// A phone-shaped screen (what the dialogs lay out against too).
Future<void> tall(WidgetTester tester, [Size size = const Size(420, 2800)]) async {
  tester.view.devicePixelRatio = 3;
  tester.view.physicalSize = size * 3;
  addTearDown(tester.view.reset);
}

/// Into view by dragging the page's own list (a text field scrolls too).
Future<void> reach(WidgetTester tester, Finder f) async {
  if (f.evaluate().isEmpty) {
    await tester.dragUntilVisible(f, find.byType(ListView).first, const Offset(0, -250));
  }
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
}

Future<void> tapIn(WidgetTester tester, Finder f) async {
  await reach(tester, f);
  await tester.tap(f);
  await tester.pumpAndSettle();
}

/// Lets the drawn signature become its PNG (the engine draws it outside the test's fake clock).
Future<void> settleInk(WidgetTester tester) async {
  for (var i = 0; i < 6; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 40)));
    await tester.pump();
  }
  await tester.pumpAndSettle();
}

Finder within(String key, String text) =>
    find.descendant(of: find.byKey(Key(key)), matching: find.text(text));

Call lastTo(FakeTransport t, String method, String path) =>
    t.calls.lastWhere((c) => c.method == method && c.path == path);

void main() {
  const s = S(false);

  group('the rules as the website', () {
    Map<String, Object?> f(Map<String, Object?> rule, {bool required = true}) => {
      'key': 'x',
      'label': 'X',
      'type': 'text',
      'required': required,
      'rule': rule,
    };
    test('show, hide and require; every operation; all and any', () {
      expect(consentRuleState(f(rule('show', 'a', 'eq', 'yes')), {'a': 'Yes'}), (
        shown: true,
        required: true,
      ));
      expect(consentRuleState(f(rule('show', 'a', 'eq', 'yes')), {'a': 'no'}), (
        shown: false,
        required: false,
      ));
      expect(consentRuleState(f(rule('hide', 'a', 'eq', 'true')), {'a': true}).shown, isFalse);
      expect(consentRuleState(f(rule('require', 'a', 'gt', '3'), required: false), {'a': 5}), (
        shown: true,
        required: true,
      ));
      expect(
        consentRuleState(f(rule('require', 'a', 'gt', '3'), required: false), {'a': 2}).required,
        isFalse,
      );
      bool holds(String op, String value, Object? v) =>
          consentRuleState(f(rule('show', 'a', op, value)), {'a': v}).shown;
      expect(holds('neq', 'Red', 'blue'), isTrue);
      expect(holds('neq', 'Red', ['Red']), isFalse);
      expect(holds('eq', 'Chess', ['Chess', 'Relay']), isTrue);
      expect(holds('contains', 'lake', 'To the LAKE'), isTrue);
      expect(holds('lt', '10', 7), isTrue);
      expect(holds('lt', '10', ''), isFalse);
      expect(holds('gt', '1', 'abc'), isFalse);
      expect(holds('in', 'Red, Blue', 'blue'), isTrue);
      expect(holds('in', 'Red, Blue', ['Green', 'RED']), isTrue);
      expect(holds('empty', '', null), isTrue);
      expect(holds('empty', '', <String>[]), isTrue);
      expect(holds('not_empty', '', 'x'), isTrue);
      expect(holds('bogus', '', 'x'), isFalse);
      final any = {
        'logic': 'any',
        'action': 'show',
        'conditions': [
          {'field': 'a', 'op': 'eq', 'value': '1'},
          {'field': 'b', 'op': 'eq', 'value': '2'},
        ],
      };
      expect(consentRuleState(f(any), {'a': 0, 'b': 2}).shown, isTrue);
      expect(consentRuleState(f({...any, 'logic': 'all'}), {'a': 0, 'b': 2}).shown, isFalse);
    });

    test('the fee: none, fixed, and a base with a rate and prices for the fields shown', () {
      final fields = [
        ...tripFields,
        {'key': 'bus', 'label': 'Bus', 'type': 'yesno'},
      ];
      expect(consentFeeOf(const {'mode': 'none', 'items': []}, fields, {}), 0);
      expect(consentFeeOf(const {'mode': 'fixed', 'amount': 450, 'items': []}, fields, {}), 450);
      final fee = {
        ...School.tripFee,
        'items': [
          ...(School.tripFee['items'] as List),
          {
            'field': 'bus',
            'prices': {'Yes': 80.5},
          },
        ],
      };
      expect(consentFeeOf(fee, fields, {'tickets': 2, 'going': false, 'meal': 'Non-veg'}), 500);
      expect(
        consentFeeOf(fee, fields, {'tickets': 2, 'going': true, 'meal': 'Non-veg', 'bus': true}),
        630.5,
      );
      expect(consentSteps(tripFields).map((x) => x.length), [3, 6]);
      expect(consentSteps(const []).length, 1);
    });
  });

  testWidgets('the list as on the website: figures, tabs, chips, folded text, answers, PDF, Pay', (
    tester,
  ) async {
    await tall(tester);
    final t = await pump(tester, const ConsentsScreen(profile: kid));
    // the figures: two to answer, one waiting, ₹300 to pay, four answered
    expect(within('cfFig-todo', '2'), findsOneWidget);
    expect(within('cfFig-waiting', '1'), findsOneWidget);
    expect(within('cfFig-fee', '₹300'), findsOneWidget);
    expect(within('cfFig-answered', '4'), findsOneWidget);
    expect(find.text('To answer (2)'), findsOneWidget);
    expect(find.text('Answered (3)'), findsOneWidget);
    expect(find.text('Closed (1)'), findsOneWidget);
    // to answer: the trip (closes today, a fee, approval) and the library card (answered once, may answer again)
    expect(find.text('Science trip to the planetarium'), findsOneWidget);
    expect(find.text('Hostel outing'), findsNothing);
    expect(within('cf-f1', 'Closes today'), findsOneWidget);
    expect(within('cf-f1', 'Has a fee'), findsOneWidget);
    expect(within('cf-f1', 'School approves'), findsOneWidget);
    expect(find.text('Answer now'), findsOneWidget);
    expect(find.text('Answer again'), findsOneWidget);
    expect(find.text('You can change your answer until ${s.date(istDay(5))}'), findsOneWidget);
    // the school's text, folded
    expect(find.text('The bus leaves at 8 am and comes back by 4 pm.'), findsNothing);
    await tapIn(tester, find.byKey(const Key('cfRead-f1')));
    expect(find.text('The bus leaves at 8 am and comes back by 4 pm.'), findsOneWidget);

    // answered: the status of each answer, the school's note, the fee
    await tapIn(tester, find.byKey(const Key('cfTab-answered')));
    expect(within('cf-f2', 'Closes tomorrow'), findsOneWidget);
    expect(within('cf-f3', 'Closes ${s.date(istDay(10))}'), findsOneWidget);
    expect(within('cfResponse-r1', 'Answered'), findsOneWidget);
    expect(within('cfResponse-r2', 'Approved'), findsOneWidget);
    expect(within('cfResponse-r2', 'Size M noted'), findsOneWidget);
    expect(within('cfResponse-r2', 'Fee ₹500 · ₹300 to pay'), findsOneWidget);
    expect(within('cfResponse-r4', 'Waiting for the school'), findsOneWidget);
    expect(within('cfResponse-r4', 'Fee ₹250 · after approval'), findsOneWidget);
    // Change while the school has not decided
    expect(find.byKey(const Key('cfChange-r1')), findsOneWidget);
    expect(find.byKey(const Key('cfChange-r4')), findsOneWidget);
    expect(find.byKey(const Key('cfChange-r2')), findsNothing);
    // the PDF copy, in the app
    await tapIn(tester, find.byKey(const Key('view-cfPdf-r2')));
    expect(t.calls.any((c) => c.path == '/engagement/mine/consent-forms/responses/r2/pdf'), isTrue);
    await tester.tap(find.byType(BackButton));
    await tester.pumpAndSettle();
    // Pay: two gateways, so the parent chooses; the misc fee line of the answer
    await tapIn(tester, find.byKey(const Key('cfPay-r2')));
    await tester.tap(find.byKey(const Key('cfGateway-g1')));
    await tester.pumpAndSettle();
    expect(lastTo(t, 'POST', '/payments/intents/mine/misc').body, {
      'lineId': 'l7',
      'gatewayId': 'g1',
      'app': 'mobile',
    });
    await tester.tap(find.byKey(const Key('mockSuccess')));
    await tester.pumpAndSettle();
    expect(
      find.text('Payment received. Thank you. The receipt is on the Fees page.'),
      findsOneWidget,
    );

    // closed: not approved, the fee with nothing to pay
    await tapIn(tester, find.byKey(const Key('cfTab-closed')));
    expect(within('cf-f4', 'Closed'), findsOneWidget);
    expect(within('cfResponse-r3', 'Not approved'), findsOneWidget);
    expect(within('cfResponse-r3', 'No seats left'), findsOneWidget);
    expect(within('cfResponse-r3', 'Fee ₹300'), findsOneWidget);
    expect(find.byKey(const Key('cfPay-r3')), findsNothing);
  });

  testWidgets(
    'staff: Forms and declarations, the forms asked of themself, answered as the website',
    (tester) async {
      const me = Profile(
        id: 'staff:7',
        kind: 'staff',
        schoolId: '7',
        schoolName: 'Sample School',
        name: 'Asha Teacher',
        app: 'teacher',
      );
      expect(nativeScreen(me, '/consents', s), isA<ConsentsScreen>());
      await tall(tester);
      await pump(tester, const ConsentsScreen(profile: me), school: School()..staff = true);
      expect(find.text(s.cfStaffTitle), findsOneWidget);
      expect(find.text(s.cfStaffLead), findsOneWidget);
      expect(find.text('Science trip to the planetarium'), findsOneWidget);
      expect(find.text('Answer now'), findsWidgets);
      // the staff part from the API, a page at a time: the tab and its first 10
      final t = await pump(
        tester,
        const ConsentsScreen(profile: me),
        school: School()..staff = true,
      );
      List<Map<String, Object?>?> asked() => [
        for (final c in t.calls)
          if (c.path == '/engagement/mine/consent-forms') c.query,
      ];
      expect(
        asked().last,
        allOf(
          containsPair('part', 'staff'),
          containsPair('tab', 'todo'),
          containsPair('page', 1),
          containsPair('size', 10),
        ),
      );
      // the figures come from the API's counts over all the staff member's forms
      final todo = staffPage(School().forms(), {})['counts'] as Map;
      expect(within('cfFig-todo', '${todo['todo']}'), findsOneWidget);
      expect(find.text(s.cfTab(s.cfToAnswer, todo['todo'] as int)), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('cfTab-answered')));
      expect(asked().last, allOf(containsPair('tab', 'answered'), containsPair('page', 1)));
      expect(find.byKey(const Key('cfTab-answered')), findsOneWidget);
    },
  );

  testWidgets('a student answers their own forms; a fee is the parent’s to pay', (tester) async {
    const student = Profile(
      id: 'student:7:41',
      kind: 'student',
      schoolId: '7',
      schoolName: 'Sample School',
      name: 'Kid Sample',
      app: 'parent',
      studentId: '41',
    );
    await tall(tester);
    await pump(tester, const ConsentsScreen(profile: student));
    expect(find.text('Answer now'), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('cfTab-answered')));
    expect(find.byKey(const Key('cfPay-r2')), findsNothing);
    expect(within('cfResponse-r2', s.cfParentPays), findsOneWidget);
  });

  testWidgets('no online payment: pay at the school office', (tester) async {
    await tall(tester);
    await pump(tester, const ConsentsScreen(profile: kid), school: School()..gateways = []);
    await tapIn(tester, find.byKey(const Key('cfTab-answered')));
    expect(find.byKey(const Key('cfPay-r2')), findsNothing);
    expect(within('cfResponse-r2', 'Pay at the school office'), findsOneWidget);
  });

  testWidgets('no forms for the child yet: each tab says so', (tester) async {
    await tall(tester);
    await pump(tester, const ConsentsScreen(profile: kid), school: School()..none = true);
    expect(within('cfFig-todo', '0'), findsOneWidget);
    expect(within('cfFig-fee', '₹0'), findsOneWidget);
    expect(find.text('Nothing to answer'), findsOneWidget);
    expect(
      find.text(
        'When the school asks for your consent, the form appears here and on your home screen.',
      ),
      findsOneWidget,
    );
    await tapIn(tester, find.byKey(const Key('cfTab-answered')));
    expect(find.text('No answers yet'), findsOneWidget);
    expect(find.text('Forms you answer stay here with their PDF copy.'), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('cfTab-closed')));
    expect(find.text('No closed forms'), findsOneWidget);
  });

  testWidgets('answering from the list, and changing an answer: the website\'s messages', (
    tester,
  ) async {
    await tall(tester);
    final t = await pump(tester, const ConsentsScreen(profile: kid));
    await tapIn(tester, find.byKey(const Key('cfAnswer-f6')));
    expect(find.text('Library card'), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('cf-keep')));
    await tapIn(tester, find.byKey(const Key('cfSubmit')));
    expect(lastTo(t, 'POST', '/engagement/mine/consent-forms/f6/responses').body, {
      'studentId': '41',
      'answers': {'keep': true},
      'signedName': 'Parent Sample',
    });
    expect(
      find.text('Thank you. Your answer is saved as CF-0030. Collect the card from the library.'),
      findsOneWidget,
    );
    // a form answered many times stays under To answer
    expect(find.text('Answer again'), findsOneWidget);

    await tapIn(tester, find.byKey(const Key('cfTab-answered')));
    await tapIn(tester, find.byKey(const Key('cfChange-r1')));
    expect(find.text('Change your answer CF-0012'), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('cf-photo-Yes')));
    await tapIn(tester, find.byKey(const Key('cfSubmit')));
    expect(lastTo(t, 'PUT', '/engagement/mine/consent-forms/responses/r1').body, {
      'answers': {'photo': true},
      'signedName': 'Parent Sample',
    });
    expect(find.text('Your answer CF-0012 is changed.'), findsOneWidget);
  });

  testWidgets(
    'filling a form in two steps: rules, the needed answers, the live fee, a file, a drawn signature',
    (tester) async {
      await tall(tester);
      final t = await pump(tester, const ConsentFillScreen(profile: kid, formId: 'f1'));
      expect(t.calls.first.query, {'studentId': '41'});
      expect(find.text('Kid Sample · VI-A'), findsOneWidget);
      expect(find.text('Science trip to the planetarium'), findsOneWidget);
      expect(find.text('The bus leaves at 8 am and comes back by 4 pm.'), findsOneWidget);
      expect(find.text('Step 1 of 2'), findsOneWidget);
      // the lunch shows only for a child who goes
      expect(find.byKey(const Key('cfField-meal')), findsNothing);
      await tapIn(tester, find.byKey(const Key('cfNext')));
      expect(find.text('Will your child go?: an answer is needed'), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('cf-going-Yes')));
      expect(find.byKey(const Key('cfField-meal')), findsOneWidget);
      expect(find.text('Lunch *'), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('cfNext')));
      expect(find.text('Lunch: an answer is needed'), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('cf-meal')));
      await tester.tap(find.text('Non-veg').last);
      await tester.pumpAndSettle();
      // a number out of range, then in it
      await reach(tester, find.byKey(const Key('cf-tickets')));
      await tester.enterText(find.byKey(const Key('cf-tickets')), '9');
      await tapIn(tester, find.byKey(const Key('cfNext')));
      expect(find.text('Extra tickets for parents: at most 4'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('cf-tickets')), '2');
      await tapIn(tester, find.byKey(const Key('cfNext')));
      expect(find.text('Step 2 of 2'), findsOneWidget);
      // the fee as the answers stand: 200 + 2 × 150 + 50 for non-veg
      expect(
        find.text('Fee: ₹550 · to pay after the school approves', findRichText: true),
        findsOneWidget,
      );
      // back, one more ticket: the fee follows
      await tapIn(tester, find.byKey(const Key('cfBack')));
      expect(find.text('Step 1 of 2'), findsOneWidget);
      await reach(tester, find.byKey(const Key('cf-tickets')));
      expect(find.text('2'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('cf-tickets')), '3');
      await tapIn(tester, find.byKey(const Key('cfNext')));
      expect(
        find.text('Fee: ₹700 · to pay after the school approves', findRichText: true),
        findsOneWidget,
      );
      // the certificate is asked for only with a peanut allergy
      expect(find.byKey(const Key('cfField-medical')), findsNothing);
      await tapIn(tester, find.byKey(const Key('cfSubmit')));
      expect(find.text('Date of travel: an answer is needed'), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('cf-allergy-Peanuts')));
      await tapIn(tester, find.byKey(const Key('cfSubmit')));
      expect(find.text('Medical certificate: an answer is needed'), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('cf-medical-add')));
      expect(find.text('allergy.pdf'), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('cf-travel_on')));
      await tester.tap(find.text('OK'));
      await tester.pumpAndSettle();
      expect(find.text(s.date(day(0))), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('cfSubmit')));
      expect(find.text('Parent signature: an answer is needed'), findsOneWidget);
      // a signature drawn with a finger
      expect(find.text('Sign in the box above'), findsOneWidget);
      await reach(tester, find.byKey(const Key('cfPad-sign')));
      await tester.drag(find.byKey(const Key('cfPad-sign')), const Offset(160, 40));
      await tester.drag(find.byKey(const Key('cfPad-sign')), const Offset(-60, -20));
      await settleInk(tester);
      expect(find.text('Signed'), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('cfSubmit')));
      expect(find.text('I agree to the rules of the trip: an answer is needed'), findsOneWidget);
      await tapIn(tester, find.byKey(const Key('cf-ok')));
      // the name of the parent signing: the signed-in name, at least two letters
      final name = tester.widget<TextField>(find.byKey(const Key('cfSignedName')));
      expect(name.controller!.text, 'Parent Sample');
      await tester.enterText(find.byKey(const Key('cfSignedName')), 'P');
      await tapIn(tester, find.byKey(const Key('cfSubmit')));
      expect(find.text('Write your name (at least 2 letters).'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('cfSignedName')), '  Parent Sample ');
      await tapIn(tester, find.byKey(const Key('cfSubmit')));
      // the file went up first; its id is in the answers
      expect(t.calls.any((c) => c.method == 'PUT' && c.path == '/upload/55'), isTrue);
      final body = lastTo(t, 'POST', '/engagement/mine/consent-forms/f1/responses').body!;
      expect(body.keys.toSet(), {'studentId', 'answers', 'signedName'});
      expect(body['studentId'], '41');
      expect(body['signedName'], 'Parent Sample');
      final answers = Map<String, Object?>.from(body['answers']! as Map);
      final sign = answers.remove('sign')! as String;
      expect(sign, startsWith('data:image/png;base64,'));
      expect(base64Decode(sign.split(',').last).take(4), [137, 80, 78, 71]);
      expect(answers, {
        'going': true,
        'meal': 'Non-veg',
        'tickets': 3,
        'allergy': ['Peanuts'],
        'medical': ['55'],
        'travel_on': day(0),
        'ok': true,
      });
    },
  );

  testWidgets('changing an answer: what was answered, the earlier signature and file kept', (
    tester,
  ) async {
    await tall(tester);
    final t = await pump(
      tester,
      const ConsentFillScreen(profile: kid, formId: 'f1', responseId: 'r9'),
    );
    expect(t.calls.first.query, {'studentId': '41', 'responseId': 'r9'});
    expect(find.text('Change your answer CF-0021'), findsOneWidget);
    // the school's text folded when changing
    expect(find.text('The bus leaves at 8 am and comes back by 4 pm.'), findsNothing);
    expect(find.byKey(const Key('cfField-meal')), findsOneWidget);
    expect(find.text('Veg'), findsOneWidget);
    expect(find.text('1'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('cf-tickets')), '2');
    await tapIn(tester, find.byKey(const Key('cfNext')));
    expect(find.text('Signed earlier: that signature stays unless you sign again'), findsOneWidget);
    expect(find.text('Sent earlier: those files stay unless you add new ones'), findsOneWidget);
    expect(find.text('Save the change'), findsOneWidget);
    // 200 + 2 × 150; no price for veg
    expect(
      find.text('Fee: ₹500 · to pay after the school approves', findRichText: true),
      findsOneWidget,
    );
    // a signature cleared without signing again is still the one kept
    await tapIn(tester, find.byKey(const Key('cfClear-sign')));
    expect(find.text('Signed earlier: that signature stays unless you sign again'), findsOneWidget);
    await tapIn(tester, find.byKey(const Key('cfSubmit')));
    expect(t.calls.any((c) => c.path == '/platform/files'), isFalse);
    expect(lastTo(t, 'PUT', '/engagement/mine/consent-forms/responses/r9').body, {
      'answers': {
        'going': true,
        'meal': 'Veg',
        'tickets': 2,
        'allergy': ['Peanuts'],
        'travel_on': '2026-11-25',
        'ok': true,
        'sign': 'keep',
        'medical': 'keep',
      },
      'signedName': 'Parent Sample',
    });
  });

  testWidgets('closed, already answered, and an answer that can no longer change', (tester) async {
    await tall(tester);
    await pump(tester, const ConsentFillScreen(profile: kid, formId: 'f4'));
    expect(find.text('This form is closed (all places are taken).'), findsOneWidget);
    expect(find.byKey(const Key('cfSubmit')), findsNothing);
    await pump(tester, const ConsentFillScreen(profile: kid, formId: 'f2'));
    expect(find.text('Already answered: CF-0012'), findsOneWidget);
    expect(find.byKey(const Key('cfSubmit')), findsNothing);
    await pump(tester, const ConsentFillScreen(profile: kid, formId: 'f3', responseId: 'r2'));
    expect(find.text('This answer can no longer be changed.'), findsOneWidget);
    expect(find.byKey(const Key('cfSubmit')), findsNothing);
    expect(const S(true).cfIsClosed('closed'), 'यह फ़ॉर्म बंद है।');
    expect(
      s.cfIsClosed('opens on 2026-12-01 09:00'),
      'This form is closed (opens on 1 Dec 2026, 09:00).',
    );
  });

  testWidgets('every kind of question on one step: radio from a school list, select, time', (
    tester,
  ) async {
    await tall(tester, const Size(420, 3600));
    final t = await pump(tester, const ConsentFillScreen(profile: kid, formId: 'f9'));
    expect(find.text('Fee: ₹120 · due once you submit', findRichText: true), findsOneWidget);
    await tester.enterText(find.byKey(const Key('cf-age')), '11');
    await tester.enterText(find.byKey(const Key('cf-mail')), 'not-an-address');
    await tapIn(tester, find.byKey(const Key('cf-house-Blue')));
    await tapIn(tester, find.byKey(const Key('cf-size')));
    await tester.tap(find.text('M').last);
    await tester.pumpAndSettle();
    await tapIn(tester, find.byKey(const Key('cf-photo-No')));
    await tapIn(tester, find.byKey(const Key('cf-at')));
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();
    await tapIn(tester, find.byKey(const Key('cf-yes')));
    await tapIn(tester, find.byKey(const Key('cfSubmit')));
    expect(find.text('E-mail: an email address is needed'), findsOneWidget);
    await tester.enterText(find.byKey(const Key('cf-mail')), 'parent@example.test');
    await tapIn(tester, find.byKey(const Key('cfSubmit')));
    final answers =
        lastTo(t, 'POST', '/engagement/mine/consent-forms/f9/responses').body!['answers']! as Map;
    expect(answers['age'], 11);
    expect(answers['mail'], 'parent@example.test');
    expect(answers['house'], 'Blue');
    expect(answers['size'], 'M');
    expect(answers['photo'], false);
    expect(answers['at'], matches(RegExp(r'^\d{2}:\d{2}$')));
    expect(answers['yes'], true);
    // nothing for the file and the signature not given
    expect(answers.containsKey('doc'), isFalse);
    expect(answers.containsKey('sig'), isFalse);
  });

  for (final (name, hindi, dark) in [
    ('light', false, false),
    ('dark', false, true),
    ('Hindi', true, false),
  ]) {
    testWidgets('accessibility ($name): the list and the form', (tester) async {
      await tall(tester, const Size(420, 3600));
      final handle = tester.ensureSemantics();
      for (final w in const [
        ConsentsScreen(profile: kid),
        ConsentFillScreen(profile: kid, formId: 'f9'),
        ConsentFillScreen(profile: kid, formId: 'f1'),
      ]) {
        await pump(tester, w, hindi: hindi, dark: dark);
        expect(
          find.text(hindi ? 'विद्यालय का संदेश पढ़ें' : 'Read what the school says'),
          findsWidgets,
          reason: 'the language',
        );
        // the list twice: To answer, then Answered (Pay, Change, the PDF icons)
        for (final tab in w is ConsentsScreen ? const ['todo', 'answered'] : const ['']) {
          if (tab == 'answered') {
            await tester.tap(find.byKey(const Key('cfTab-answered')));
            await tester.pumpAndSettle();
            expect(find.byKey(const Key('cfPay-r2')), findsOneWidget);
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
              reason: '${w.runtimeType} $tab: ${g.description}',
            );
          }
        }
      }
      handle.dispose();
    });
  }

  testWidgets('every control named for screen readers: the signature box, the list, a date', (
    tester,
  ) async {
    await tall(tester, const Size(420, 3600));
    final handle = tester.ensureSemantics();
    await pump(tester, const ConsentFillScreen(profile: kid, formId: 'f9'));
    expect(find.bySemanticsLabel('Signature: sign in this box'), findsOneWidget);
    expect(find.bySemanticsLabel('Clear Signature'), findsOneWidget);
    // a text box named by its question (shown above it)
    expect(find.bySemanticsLabel(RegExp(r'^Age \*')), findsOneWidget);
    // the type-to-search list, by its question; its arrow too
    expect(find.bySemanticsLabel('T-shirt size'), findsWidgets);
    expect(find.bySemanticsLabel('Date of the visit: Choose a date'), findsOneWidget);
    expect(find.bySemanticsLabel('Add a file: Doctor’s note'), findsOneWidget);
    handle.dispose();
  });

  testWidgets('large text (twice the size) on a phone: the list and the form', (tester) async {
    await tall(tester, const Size(360, 780));
    for (final hindi in [false, true]) {
      for (final w in const [
        ConsentsScreen(profile: kid),
        ConsentFillScreen(profile: kid, formId: 'f9'),
        ConsentFillScreen(profile: kid, formId: 'f1'),
      ]) {
        await pump(tester, w, hindi: hindi, text: 2);
        expect(tester.takeException(), isNull, reason: '${w.runtimeType} hindi=$hindi');
        // the words are the language asked for
        final words = hindi ? const S(true) : s;
        expect(
          find.text(w is ConsentsScreen ? words.cfLead : words.cfReadSchool, skipOffstage: false),
          findsOneWidget,
          reason: '${w.runtimeType} hindi=$hindi',
        );
        await tester.drag(find.byType(ListView).first, const Offset(0, -6000));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: '${w.runtimeType} scrolled');
      }
      // the list's other tabs
      await pump(tester, const ConsentsScreen(profile: kid), hindi: hindi, text: 2);
      for (final tab in ['answered', 'closed']) {
        await tapIn(tester, find.byKey(Key('cfTab-$tab')));
        await tester.drag(find.byType(ListView).first, const Offset(0, -6000));
        await tester.pumpAndSettle();
        expect(tester.takeException(), isNull, reason: 'tab $tab hindi=$hindi');
        await tester.drag(find.byType(ListView).first, const Offset(0, 6000));
        await tester.pumpAndSettle();
      }
    }
  });
}

/// The API's `part=staff` answer (GET /engagement/mine/consent-forms): the figures over all the staff member's
/// forms, then the tab's forms a page at a time.
Map<String, Object?> staffPage(List<Map<String, Object?>> own, Map<String, Object?> q) {
  Map<String, Object?> me(Map<String, Object?> f) =>
      (f['people'] as List).first as Map<String, Object?>;
  String? tabOf(Map<String, Object?> f) => me(f)['canAnswer'] == true
      ? 'todo'
      : f['open'] != true
      ? 'closed'
      : (me(f)['responses'] as List).isNotEmpty
      ? 'answered'
      : null;
  final answers = [for (final f in own) ...(me(f)['responses'] as List).cast<Map>()];
  final list = q['tab'] == null ? own : own.where((f) => tabOf(f) == q['tab']).toList();
  final page = int.parse('${q['page'] ?? 1}');
  final size = int.parse('${q['size'] ?? 10}');
  return {
    'forms': list.skip((page - 1) * size).take(size).toList(),
    'children': <Object?>[],
    'staff': true,
    'counts': {
      'todo': own.where((f) => tabOf(f) == 'todo').length,
      'answered': own.where((f) => tabOf(f) == 'answered').length,
      'closed': own.where((f) => tabOf(f) == 'closed').length,
      'answeredAll': own
          .where((f) => tabOf(f) != 'todo' && (me(f)['responses'] as List).isNotEmpty)
          .length,
      'waiting': answers.where((a) => a['waiting'] == true).length,
      'feeDue': 0,
    },
    'page': {'number': page, 'size': size, 'total': list.length},
  };
}
