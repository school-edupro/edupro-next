import 'dart:convert';

import 'package:edupro/api/api_transport.dart';
import 'package:edupro/app_services.dart';
import 'package:edupro/family/today.dart';
import 'package:edupro/l10n/strings.dart';
import 'package:edupro/theme/theme.dart';
import 'package:edupro/ui/brand.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fakes.dart';

/// A 1 × 1 PNG (the school's logo in these tests).
const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

void main() {
  group('the school remembered on the phone (look B)', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    Future<(ProviderContainer, FakeTransport)> container(Answer answer) async {
      final t = FakeTransport(answer);
      final c = ProviderContainer(overrides: [transportProvider.overrideWithValue(t)]);
      addTearDown(c.dispose);
      c.read(schoolBrandProvider);
      await Future<void>.delayed(Duration.zero);
      return (c, t);
    }

    test('its logo is fetched once, kept, and read back by the next start', () async {
      final (c, t) = await container((call) {
        expect(call.path, '/public/schools/SAMPLE/logo');
        return {'contentType': 'image/png', 'base64': png};
      });
      await c.read(schoolBrandProvider.notifier).remember(code: 'SAMPLE', name: 'Sample School');
      expect(c.read(schoolBrandProvider)!.logo, base64Decode(png));
      await c.read(schoolBrandProvider.notifier).remember(code: 'SAMPLE', name: 'Sample School');
      expect(t.calls, hasLength(1));
      // the next start reads it from the phone, with no call
      final (c2, t2) = await container((_) => fail('no call'));
      expect(c2.read(schoolBrandProvider)?.name, 'Sample School');
      expect(c2.read(schoolBrandProvider)?.logo, base64Decode(png));
      expect(t2.calls, isEmpty);
    });

    test(
      'a school with no logo is asked once; no network is asked again; another school is new',
      () async {
        var offline = true;
        final (c, t) = await container((call) {
          if (offline) throw const ApiException(0, 'offline', 'no network');
          throw const ApiException(404, 'not-found', 'The school has no logo');
        });
        final b = c.read(schoolBrandProvider.notifier);
        await b.remember(code: 'SAMPLE', name: 'Sample School');
        expect(c.read(schoolBrandProvider)!.noLogo, isFalse);
        offline = false;
        await b.remember(code: 'SAMPLE', name: 'Sample School');
        expect(c.read(schoolBrandProvider)!.noLogo, isTrue);
        await b.remember(code: 'SAMPLE', name: 'Sample School');
        expect(t.calls, hasLength(2));
        await b.remember(code: 'OTHER', name: 'Other School');
        expect(t.calls.last.path, '/public/schools/OTHER/logo');
        expect(c.read(schoolBrandProvider)!.name, 'Other School');
        // no code (an older API): nothing changes
        await b.remember(code: null, name: 'Nameless');
        expect(c.read(schoolBrandProvider)!.name, 'Other School');
      },
    );

    test('a logo too big for the phone is not kept', () async {
      final big = base64Encode(List<int>.filled(SchoolBrandController.maxLogoBytes + 1, 1));
      final (c, _) = await container((_) => {'contentType': 'image/png', 'base64': big});
      await c.read(schoolBrandProvider.notifier).remember(code: 'SAMPLE', name: 'Sample School');
      expect(c.read(schoolBrandProvider)!.logo, isNull);
      expect(c.read(schoolBrandProvider)!.noLogo, isTrue);
    });
  });

  group("today's classes", () {
    final week = {
      'periods': [
        {'id': 1, 'number': 1, 'startsAt': '09:00:00', 'endsAt': '09:40:00'},
        {'id': 2, 'number': null, 'startsAt': '09:40:00', 'endsAt': '10:00:00', 'isBreak': true},
        {'id': 3, 'number': 2, 'startsAt': '10:00:00', 'endsAt': '10:40:00'},
        {'id': 4, 'number': 3, 'startsAt': '10:40:00', 'endsAt': '11:20:00'},
      ],
      'slots': [
        {'weekday': 4, 'periodId': 1, 'subjectName': 'English'},
        {'weekday': 4, 'periodId': 3, 'subjectName': 'Science'},
        {'weekday': 5, 'periodId': 4, 'subjectName': 'Hindi'},
      ],
    };

    test("the day's periods in order, breaks and other days left out", () {
      // 19 Nov 2026 is a Thursday (weekday 4)
      final rows = classesToday(week, DateTime(2026, 11, 19, 10, 5));
      expect(rows.map((r) => r['title']), ['English', 'Science']);
      expect(rows.first['startsAt'], '09:00:00');
      expect(classesToday(week, DateTime(2026, 11, 22)), isEmpty); // a Sunday
      expect(minutesOf('09:20:00'), 560);
      expect(minutesOf('9:05'), 545);
      expect(minutesOf(null), isNull);
    });

    testWidgets('the one on now is tagged, the ones over ticked', (tester) async {
      final now = DateTime(2026, 11, 19, 10, 5);
      await tester.pumpWidget(
        ProviderScope(
          child: MaterialApp(
            theme: eduproTheme(brightness: Brightness.light, webFonts: false),
            home: Scaffold(
              body: ClassesCard(rows: classesToday(week, now), now: now),
            ),
          ),
        ),
      );
      const s = S(false);
      expect(find.text(s.nowTag), findsOneWidget);
      expect(
        find.byWidgetPredicate((w) => w is Icon && w.semanticLabel == s.doneTag),
        findsOneWidget,
      );
      expect(find.text('09:00'), findsOneWidget);
    });
  });
}
