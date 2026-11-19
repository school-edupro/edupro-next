import 'package:edupro/api/api_transport.dart';
import 'package:edupro/api/endpoints.g.dart';
import 'package:edupro/api/outbox.dart';
import 'package:edupro/app_services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fakes.dart';

/// The phone's outbox (docs/design/89 §5.6): writes kept with no network and sent later with their own key.
/// Every name and number here is made up.
void main() {
  late bool offline;
  late String? refuse;
  late FakeTransport t;
  late ProviderContainer c;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    offline = false;
    refuse = null;
    t = FakeTransport((call) {
      if (offline) throw const ApiException(0, 'offline', 'No connection');
      if (refuse != null && call.body?['reason'] == refuse) {
        throw const ApiException(409, 'attendance.locked', 'The day is locked.');
      }
      return {'ok': call.body?['reason']};
    });
    c = ProviderContainer(overrides: [transportProvider.overrideWithValue(t)]);
    c.read(outboxProvider);
    await Future<void>.delayed(Duration.zero);
  });
  tearDown(() => c.dispose());

  Future<Sent> send(String n, [ProviderContainer? on]) => (on ?? c)
      .read(outboxProvider.notifier)
      .send(
        label: 'Write $n',
        schoolId: '7',
        call: (api) => api.leaveApply(
          body: LeaveApplyDto(
            studentId: '41',
            leaveType: 'SICK',
            fromDate: '2026-11-20',
            toDate: '2026-11-20',
            reason: n,
          ),
        ),
      );

  test('with the network, sent at once with its school and a key', () async {
    expect(await send('one'), Sent.now);
    expect(c.read(outboxProvider), isEmpty);
    expect(t.calls.single.path, '/attendance/leaves/mine');
    expect(t.calls.single.headers['X-School-Id'], '7');
    expect(t.calls.single.headers['Idempotency-Key'], isA<String>());
  });

  test('without it, kept on the phone; sent in order when back, the same key each time', () async {
    offline = true;
    expect(await send('one'), Sent.later);
    expect(await send('two'), Sent.later);
    expect(c.read(outboxProvider).map((i) => i.label), ['Write one', 'Write two']);
    // kept across a restart of the app
    final saved = (await SharedPreferences.getInstance()).getString('outbox');
    expect(saved, contains('Write two'));
    final keys = c.read(outboxProvider).map((i) => i.key).toList();
    expect(keys.toSet().length, 2);

    offline = false;
    t.calls.clear();
    await c.read(outboxProvider.notifier).flush();
    expect(c.read(outboxProvider), isEmpty);
    expect(t.calls.map((x) => x.body!['reason']), ['one', 'two']);
    expect(t.calls.map((x) => x.headers['Idempotency-Key']), keys);
    expect((await SharedPreferences.getInstance()).getString('outbox'), isNull);
  });

  test('a new write waits behind older ones (never overtakes them)', () async {
    offline = true;
    await send('one');
    offline = false;
    // the network is back but the older one has not gone yet: the new one queues behind it
    t.calls.clear();
    expect(await send('two'), Sent.later);
    await c.read(outboxProvider.notifier).flush();
    expect(t.calls.map((x) => x.body!['reason']), ['one', 'two']);
    expect(c.read(outboxProvider), isEmpty);
  });

  test(
    'a write the school refuses is kept with the reason until removed; the next goes on',
    () async {
      offline = true;
      await send('one');
      await send('two');
      offline = false;
      refuse = 'one';
      await c.read(outboxProvider.notifier).flush();
      final left = c.read(outboxProvider);
      expect(left.map((i) => i.label), ['Write one']);
      expect(left.single.error, 'The day is locked.');
      // a refused one is not sent again by itself
      t.calls.clear();
      await c.read(outboxProvider.notifier).flush();
      expect(t.calls, isEmpty);
      await c.read(outboxProvider.notifier).remove(left.single.key);
      expect(c.read(outboxProvider), isEmpty);
    },
  );

  test('a refusal when sent at once is thrown, not kept', () async {
    refuse = 'one';
    await expectLater(send('one'), throwsA(isA<ApiException>()));
    expect(c.read(outboxProvider), isEmpty);
  });

  test('the same write still being handled is tried again later, not refused', () async {
    final c2 = ProviderContainer(
      overrides: [
        transportProvider.overrideWithValue(
          FakeTransport(
            (_) =>
                throw const ApiException(409, 'idempotency.in_progress', 'Try again in a moment.'),
          ),
        ),
      ],
    );
    addTearDown(c2.dispose);
    c2.read(outboxProvider);
    await Future<void>.delayed(Duration.zero);
    expect(await send('one', c2), Sent.later);
    expect(c2.read(outboxProvider).single.error, isNull);
  });

  test('sign-out clears what waits', () async {
    offline = true;
    await send('one');
    await c.read(outboxProvider.notifier).clear();
    expect(c.read(outboxProvider), isEmpty);
    expect((await SharedPreferences.getInstance()).getString('outbox'), isNull);
  });
}
