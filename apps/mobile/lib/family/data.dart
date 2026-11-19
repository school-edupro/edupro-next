import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_transport.dart';
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../profiles/profiles.dart';
import 'cache_store.dart';

/// What a screen shows: the API's answer, when it came, and whether it is the last copy kept on the phone because
/// there is no network (docs/design/89 §5.6: every screen shows the last copy it had, with "updated at").
class Loaded<T> {
  const Loaded(this.data, this.at, {this.stale = false});
  final T data;
  final DateTime at;
  final bool stale;
}

/// The last copies are kept by [cacheStore] (a file each on a phone) and wiped at sign-out.
Future<void> clearCache() => cacheStore.clear();

/// Loads from the API and keeps a copy; with no network, gives the copy kept last time (or the error when none).
Future<Loaded<dynamic>> cached(String key, Future<dynamic> Function() load) async {
  try {
    final data = await load();
    final at = DateTime.now();
    try {
      await cacheStore.write(key, jsonEncode({'at': at.toIso8601String(), 'data': data}));
    } catch (_) {
      // a copy that cannot be kept (storage full) never stops the screen
    }
    return Loaded<dynamic>(data, at);
  } on ApiException catch (e) {
    if (!e.offline) rethrow;
    final raw = await cacheStore.read(key);
    if (raw == null) rethrow;
    final j = jsonDecode(raw) as Map<String, dynamic>;
    return Loaded<dynamic>(j['data'], DateTime.parse('${j['at']}'), stale: true);
  }
}

/// `2026-11-19`
String ymd(DateTime d) =>
    '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// `2026-11`
String ym(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}';

typedef Json = Map<String, dynamic>;

Json asJson(Object? o) => o is Map ? Map<String, dynamic>.from(o) : <String, dynamic>{};
List<Json> asList(Object? o) => o is List ? [for (final x in o) asJson(x)] : <Json>[];

/// The profile's child in an answer that lists the family's children (`id`, `studentId` or `student.id`).
Json? childIn(Object? children, Profile p) {
  for (final c in asList(children)) {
    final id = c['id'] ?? c['studentId'] ?? asJson(c['student'])['id'];
    if ('$id' == p.studentId) return c;
  }
  return null;
}

EduProApi _api(Ref ref) => ref.read(apiProvider);

/// The child's attendance for a month (`2026-11`): the days with their codes and the month's summary.
final attendanceProvider = FutureProvider.autoDispose.family<Loaded<Json?>, (Profile, String)>((
  ref,
  a,
) async {
  final (p, month) = a;
  final r = await cached('att:${p.id}:$month', () => _api(ref).attendanceMine(month: month));
  return Loaded(childIn(asJson(r.data)['children'], p), r.at, stale: r.stale);
});

/// The child's leave applications, the kinds of leave and the school's rules for them.
final leavesProvider = FutureProvider.autoDispose.family<Loaded<Json>, Profile>((ref, p) async {
  final r = await cached('leave:${p.id}', () => _api(ref).leaveMine());
  final j = asJson(r.data);
  j['leaves'] = asList(j['leaves']).where((l) => '${l['studentId']}' == p.studentId).toList();
  return Loaded(j, r.at, stale: r.stale);
});

/// The child's class section (the homework and the timetable are the section's).
Future<String?> _sectionOf(Ref ref, Profile p) async {
  final r = await cached('viewer:${p.id}', () => _api(ref).dailyWorkViewerInfo());
  return childIn(asJson(r.data)['students'], p)?['classSectionId'] as String?;
}

/// Homework, classwork and assignments given from `from` to `to`, newest first.
final homeworkProvider = FutureProvider.autoDispose
    .family<Loaded<List<Json>>, (Profile, String, String)>((ref, a) async {
      final (p, from, to) = a;
      final r = await cached('work:${p.id}:$from:$to', () async {
        final section = await _sectionOf(ref, p);
        if (section == null) return {'data': []};
        return _api(ref).dailyWorkList(classSectionId: section, from: from, to: to, size: 200);
      });
      final list = asList(asJson(r.data)['data'])
        ..sort((x, y) => '${y['assignedOn']}'.compareTo('${x['assignedOn']}'));
      return Loaded(list, r.at, stale: r.stale);
    });

/// The notices and circulars the child's family may read, pinned first.
final noticesProvider = FutureProvider.autoDispose.family<Loaded<List<Json>>, Profile>((
  ref,
  p,
) async {
  final r = await cached(
    'notices:${p.id}',
    () => _api(ref).noticesList(studentId: p.studentId, size: 50),
  );
  return Loaded(asList(asJson(r.data)['data']), r.at, stale: r.stale);
});

/// One notice in full.
final noticeProvider = FutureProvider.autoDispose.family<Loaded<Json>, (Profile, String)>((
  ref,
  a,
) async {
  final (p, id) = a;
  final r = await cached('notice:${p.id}:$id', () => _api(ref).noticesGet(id: id));
  final j = asJson(r.data);
  return Loaded(j['data'] is Map ? asJson(j['data']) : j, r.at, stale: r.stale);
});

/// A page (20 a page, the newest first) of the school's messages to the family about the child.
final inboxProvider = FutureProvider.autoDispose.family<Loaded<Json>, (Profile, int)>((
  ref,
  a,
) async {
  final (p, page) = a;
  final r = await cached(
    'inbox:${p.id}:$page',
    () => _api(ref).commsInboxList(studentId: p.studentId, page: page, size: 20),
  );
  return Loaded(asJson(r.data), r.at, stale: r.stale);
});

/// How many of the person's messages are unread.
final unreadProvider = FutureProvider.autoDispose.family<int, Profile>((ref, p) async {
  final r = await cached('unread:${p.id}', () => _api(ref).commsInboxUnread());
  return (asJson(r.data)['unread'] as num?)?.toInt() ?? 0;
});

/// The school's periods and the child's section's week.
final timetableProvider = FutureProvider.autoDispose.family<Loaded<Json>, Profile>((ref, p) async {
  final r = await cached('tt:${p.id}', () async {
    final section = await _sectionOf(ref, p);
    final periods = asJson(await _api(ref).timetablePeriods())['data'];
    final slots = section == null
        ? []
        : asJson(await _api(ref).timetableSlots(classSectionId: section))['data'];
    return {'periods': periods, 'slots': slots};
  });
  return Loaded(asJson(r.data), r.at, stale: r.stale);
});

/// The school's holidays and events from `from` to `to`.
final calendarProvider = FutureProvider.autoDispose.family<Loaded<Json>, (Profile, String, String)>(
  (ref, a) async {
    final (p, from, to) = a;
    final r = await cached(
      'cal:${p.schoolId}:$from:$to',
      () => _api(ref).calendarRead(from: from, to: to),
    );
    return Loaded(asJson(r.data), r.at, stale: r.stale);
  },
);

/// The child's exams with their papers (the date sheet).
final dateSheetProvider = FutureProvider.autoDispose.family<Loaded<List<Json>>, Profile>((
  ref,
  p,
) async {
  final r = await cached('ds:${p.id}', () => _api(ref).examDateSheetsFamily());
  return Loaded(asList(childIn(asJson(r.data)['children'], p)?['exams']), r.at, stale: r.stale);
});

/// The child's released results (exam, term and annual cards).
final resultsProvider = FutureProvider.autoDispose.family<Loaded<List<Json>>, Profile>((
  ref,
  p,
) async {
  final r = await cached('res:${p.id}', () => _api(ref).familyResultsMine());
  return Loaded(asList(childIn(asJson(r.data)['children'], p)?['terms']), r.at, stale: r.stale);
});

/// The child's fee statement for the year (null when the school has none for the child yet).
final feesProvider = FutureProvider.autoDispose.family<Loaded<Json?>, Profile>((ref, p) async {
  final r = await cached('fees:${p.id}', () => _api(ref).feesMine());
  return Loaded(childIn(asJson(r.data)['children'], p), r.at, stale: r.stale);
});

/// The report card PDF: asks the API to make it, then waits for it (up to [wait]) and fetches it.
Future<ApiFile> reportCardPdf(
  EduProApi api,
  ApiTransport t, {
  required String releaseId,
  required String studentId,
  required String late,
  required String failed,
  Duration every = const Duration(seconds: 2),
  Duration wait = const Duration(seconds: 60),
}) async {
  final q = asJson(await api.familyResultsPdf(releaseId: releaseId, studentId: studentId));
  final id = '${q['exportId']}';
  final until = DateTime.now().add(wait);
  while (true) {
    final st = asJson(await api.familyResultsStatus(id: id));
    final dl = asJson(st['download']);
    if (dl['url'] is String) {
      return t.download('${dl['url']}', name: 'report-card.pdf', contentType: 'application/pdf');
    }
    final status = '${asJson(st['export'])['status']}';
    if (status == 'failed' || status == 'expired') throw ApiException(500, 'export.failed', failed);
    if (DateTime.now().isAfter(until)) throw ApiException(202, 'export.late', late);
    await Future<void>.delayed(every);
  }
}
