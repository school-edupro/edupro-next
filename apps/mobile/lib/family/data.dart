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

/// The child's school bus in a month (`2026-11`): each day's morning and afternoon, the route, the trips counted.
final busRollProvider = FutureProvider.autoDispose.family<Loaded<Json?>, (Profile, String)>((
  ref,
  a,
) async {
  final (p, month) = a;
  final r = await cached('bus:${p.id}:$month', () => _api(ref).busRollMine(month: month));
  return Loaded(childIn(asJson(r.data)['children'], p), r.at, stale: r.stale);
});

/// The child's session month by month: school days, present, absent, leave and late, with the totals.
final attendanceYearProvider = FutureProvider.autoDispose.family<Loaded<Json?>, Profile>((
  ref,
  p,
) async {
  final r = await cached('attYear:${p.id}', () => _api(ref).attendanceDeskFamilyYear());
  return Loaded(childIn(asJson(r.data)['children'], p), r.at, stale: r.stale);
});

/// The child's assignments given from `from` to `to` (either empty: no limit on that side), as the website's
/// Assignments tab.
final assignmentsProvider = FutureProvider.autoDispose
    .family<Loaded<List<Json>>, (Profile, String, String)>((ref, a) async {
      final (p, from, to) = a;
      final r = await cached('assign:${p.id}:$from:$to', () async {
        final section = await _sectionOf(ref, p);
        if (section == null) return {'data': []};
        return _api(ref).dailyWorkList(
          classSectionId: section,
          kind: 'assignment',
          from: from.isEmpty ? null : from,
          to: to.isEmpty ? null : to,
          size: 200,
        );
      });
      return Loaded(asList(asJson(r.data)['data']), r.at, stale: r.stale);
    });

/// Who teaches the child (the class teacher first, then each subject's teacher) and how much of their contact the
/// school shows (`full`, `masked` or `hidden`): `{contact, child}`.
final myTeachersProvider = FutureProvider.autoDispose.family<Loaded<Json>, Profile>((ref, p) async {
  final r = await cached('teachers:${p.id}', () => _api(ref).academicSettingsMyTeachers());
  final j = asJson(r.data);
  return Loaded(
    {'contact': asJson(j['contact']), 'child': childIn(j['students'], p)},
    r.at,
    stale: r.stale,
  );
});

/// A teacher's photo for the family (the API checks the teacher teaches the child); none when it cannot be had.
final teacherPhotoProvider = FutureProvider.autoDispose.family<ApiFile?, String>((
  ref,
  employeeId,
) async {
  try {
    final f = await _api(ref).academicSettingsTeacherPhoto(employeeId: employeeId);
    return RegExp(r'^image/(png|jpeg|webp)$').hasMatch(f.contentType) ? f : null;
  } on ApiException {
    return null;
  }
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

/// One clinic visit in full.
final healthVisitProvider = FutureProvider.autoDispose.family<Json, String>(
  (ref, id) async => asJson(await _api(ref).clinicMineVisit(id: id)),
);

/// One health check-up card in full, section by section.
final healthCardProvider = FutureProvider.autoDispose.family<Json, String>(
  (ref, id) async => asJson(await _api(ref).clinicMineCardDetail(id: id)),
);

/// The certificates and requests of the family (the register's, the types to ask for, the requests) and the
/// achievement certificates of the earlier module: `{mine, awards}`.
final certificatesProvider = FutureProvider.autoDispose.family<Loaded<Json>, Profile>((
  ref,
  p,
) async {
  final r = await cached('certs:${p.id}', () async {
    final awards = asJson(await _api(ref).engagementPlusMyCertificates())['data'];
    Object? mine;
    try {
      mine = await _api(ref).certificateRequestsMine();
    } on ApiException catch (e) {
      if (e.offline) rethrow;
      mine = const {'students': [], 'types': [], 'requests': [], 'certificates': []};
    }
    return {'mine': mine, 'awards': awards};
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

/// The whole session's holidays and events, as the website's Calendar reads them (`{holidays, events, from, to}`).
final sessionCalendarProvider = FutureProvider.autoDispose.family<Loaded<Json>, Profile>((
  ref,
  p,
) async {
  // staff read the staff calendar (every staff member: for everyone and for staff — docs/design/96, part 4)
  final r = await cached(
    'calSession:${p.schoolId}:${p.isStaff ? 'staff' : 'family'}',
    () => p.isStaff ? _api(ref).calendarStaffRead() : _api(ref).calendarRead(),
  );
  return Loaded(asJson(r.data), r.at, stale: r.stale);
});

/// The school directory: whom to contact for what, under its headings.
final directoryProvider = FutureProvider.autoDispose.family<Loaded<List<Json>>, Profile>((
  ref,
  p,
) async {
  final r = await cached('directory:${p.schoolId}', () => _api(ref).documentsDirectory());
  return Loaded(asList(asJson(r.data)['data']), r.at, stale: r.stale);
});

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

/// The child's other fees (a trip, an activity, a form), as the school announced them.
final miscFeesProvider = FutureProvider.autoDispose.family<Loaded<Json?>, Profile>((ref, p) async {
  final r = await cached('misc:${p.id}', () => _api(ref).miscFeesMine());
  return Loaded(childIn(asJson(r.data)['children'], p), r.at, stale: r.stale);
});

/// The family's online payments of this child (recent first).
final feeIntentsProvider = FutureProvider.autoDispose.family<List<Json>, Profile>((ref, p) async {
  try {
    final r = asJson(await _api(ref).paymentsMine());
    return [
      for (final x in asList(r['data']))
        if ('${x['entityId']}' == p.studentId) x,
    ];
  } on ApiException catch (e) {
    // a parent the school does not let pay online has no online payments to show
    if (e.status == 403) return const [];
    rethrow;
  }
});

/// The gateways a fee (school, hostel, misc) may be paid through, with their convenience charge. Null: the
/// person may not pay online (no permission); empty: the school has opened no gateway for this fee.
final feeGatewaysProvider = FutureProvider.autoDispose.family<List<Json>?, (Profile, String)>((
  ref,
  args,
) async {
  final (_, ledger) = args;
  try {
    return asList(asJson(await _api(ref).paymentsGatewayOptions(ledger: ledger))['data']);
  } on ApiException catch (e) {
    if (e.status == 403) return null;
    rethrow;
  }
});

/// The fee bill of the child for the session: all fees, the school fee or the hostel fee.
final feeBillProvider = FutureProvider.autoDispose.family<Loaded<Json>, (Profile, String)>((
  ref,
  args,
) async {
  final (p, ledger) = args;
  final r = await cached(
    'bill:${p.id}:$ledger',
    () => _api(ref).feesMyBill(studentId: p.studentId!, ledger: ledger),
  );
  return Loaded(asJson(r.data), r.at, stale: r.stale);
});

/// The tax certificate of the child for a financial year (null: the current one).
final taxCertificateProvider = FutureProvider.autoDispose.family<Loaded<Json>, (Profile, String?)>((
  ref,
  args,
) async {
  final (p, year) = args;
  final r = await cached(
    'tax:${p.id}:${year ?? ''}',
    () => _api(ref).feesMyTaxCertificate(studentId: p.studentId!, financialYearId: year),
  );
  return Loaded(asJson(r.data), r.at, stale: r.stale);
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
