import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_transport.dart';
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../family/data.dart';
import '../profiles/profiles.dart';

export '../family/data.dart' show Json, Loaded, asJson, asList, cached, ym, ymd;

EduProApi _api(Ref ref) => ref.read(apiProvider);

/// Today in India (the school's day), whatever the phone's own zone.
DateTime schoolToday() {
  final n = DateTime.now().toUtc().add(const Duration(hours: 5, minutes: 30));
  return DateTime(n.year, n.month, n.day);
}

/// The person's teaching assignments: the sections they mark, teach, post homework for. A person without any (or
/// without the right to see them) has none.
final assignmentsProvider = FutureProvider.autoDispose.family<Loaded<List<Json>>, Profile>((
  ref,
  p,
) async {
  final r = await cached('assign:${p.id}', () async {
    try {
      return await _api(ref).teacherAssignmentsMine();
    } on ApiException catch (e) {
      if (e.status == 403 || e.status == 404) return {'data': []};
      rethrow;
    }
  });
  return Loaded(asList(asJson(r.data)['data']), r.at, stale: r.stale);
});

/// The person's week: the school's periods, their timetable, and the substitutions given to them.
final myWeekProvider = FutureProvider.autoDispose.family<Loaded<Json>, Profile>((ref, p) async {
  final r = await cached('week:${p.id}', () async {
    Future<Object?> quiet(Future<dynamic> Function() f) async {
      try {
        return asJson(await f())['data'];
      } on ApiException catch (e) {
        if (e.status == 403 || e.status == 404) return [];
        rethrow;
      }
    }

    return {
      'periods': await quiet(() => _api(ref).timetablePeriods()),
      'slots': await quiet(() => _api(ref).timetableMine()),
      'substitutions': await quiet(() => _api(ref).substitutionsMine()),
    };
  });
  return Loaded(asJson(r.data), r.at, stale: r.stale);
});

/// The day's attendance by section (which are marked), for the sections the person may see.
final daySummaryProvider = FutureProvider.autoDispose.family<Loaded<Json>, (Profile, String)>((
  ref,
  a,
) async {
  final (p, date) = a;
  final r = await cached('daysum:${p.id}:$date', () => _api(ref).attendanceSummary(date: date));
  return Loaded(asJson(r.data), r.at, stale: r.stale);
});

/// A section's roll for a day (day attendance, or a subject's when [subjectId] is given).
final rollProvider = FutureProvider.autoDispose
    .family<Loaded<Json>, (Profile, String, String, String?)>((ref, a) async {
      final (p, section, date, subject) = a;
      final r = await cached(
        'roll:${p.id}:$section:$date:${subject ?? 'day'}',
        () => _api(ref).attendanceSession(
          classSectionId: section,
          date: date,
          kind: subject == null ? null : 'subject',
          subjectId: subject,
        ),
      );
      return Loaded(asJson(r.data), r.at, stale: r.stale);
    });

/// Marks, indicators, remarks still to enter (the person's exam sheets).
final toEnterProvider = FutureProvider.autoDispose.family<Loaded<List<Json>>, Profile>((
  ref,
  p,
) async {
  final r = await cached('toenter:${p.id}', () async {
    try {
      return await _api(ref).examEntryToEnter();
    } on ApiException catch (e) {
      if (e.status == 403 || e.status == 404) return {'data': []};
      rethrow;
    }
  });
  return Loaded(asList(asJson(r.data)['data']), r.at, stale: r.stale);
});

/// The sections and subjects of an exam the person may enter marks for.
final entrySectionsProvider = FutureProvider.autoDispose
    .family<Loaded<List<Json>>, (Profile, String)>((ref, a) async {
      final (p, exam) = a;
      final r = await cached('entry:${p.id}:$exam', () => _api(ref).examEntrySections(id: exam));
      return Loaded(asList(asJson(r.data)['data']), r.at, stale: r.stale);
    });

/// One marks sheet: an exam's subject for a section.
final marksSheetProvider = FutureProvider.autoDispose
    .family<Loaded<Json>, (Profile, String, String, String)>((ref, a) async {
      final (p, exam, section, subject) = a;
      final r = await cached(
        'marks:${p.id}:$exam:$section:$subject',
        () => _api(ref).examEntryMarks(id: exam, classSectionId: section, subjectId: subject),
      );
      return Loaded(asJson(r.data), r.at, stale: r.stale);
    });

/// The sections and subjects the person may post homework for.
final workOptionsProvider = FutureProvider.autoDispose.family<Loaded<List<Json>>, Profile>((
  ref,
  p,
) async {
  final r = await cached('workopt:${p.id}', () async {
    try {
      return await _api(ref).dailyWorkSheetOptions();
    } on ApiException catch (e) {
      if (e.status == 403 || e.status == 404) return {'data': []};
      rethrow;
    }
  });
  return Loaded(asList(asJson(r.data)['data']), r.at, stale: r.stale);
});

/// The person's own attendance for a month (from the school's punches) and the corrections asked for.
final myStaffAttendanceProvider = FutureProvider.autoDispose
    .family<Loaded<Json>, (Profile, String)>((ref, a) async {
      final (p, month) = a;
      final r = await cached(
        'myatt:${p.id}:$month',
        () => _api(ref).staffAttendanceMine(month: month),
      );
      return Loaded(asJson(r.data), r.at, stale: r.stale);
    });

/// The person's leave: balances, kinds, their requests.
final myLeaveProvider = FutureProvider.autoDispose.family<Loaded<Json>, Profile>((ref, p) async {
  final r = await cached('myleave:${p.id}', () => _api(ref).staffLeaveMine(size: 50));
  return Loaded(asJson(r.data), r.at, stale: r.stale);
});

/// The financial year (April to March) a day is in: `2026` for 2026-27.
String financialYear(DateTime d) => '${d.month >= 4 ? d.year : d.year - 1}';

/// The person's payslips of a financial year.
final payslipsProvider = FutureProvider.autoDispose.family<Loaded<Json>, (Profile, String)>((
  ref,
  a,
) async {
  final (p, fy) = a;
  final r = await cached('slips:${p.id}:$fy', () => _api(ref).payrollPayslipMine(fy: fy));
  return Loaded(asJson(r.data), r.at, stale: r.stale);
});

/// Everything waiting for the person's decision (the approvals inbox).
final approvalsProvider = FutureProvider.autoDispose.family<Loaded<Json>, Profile>((ref, p) async {
  final r = await cached('approvals:${p.id}', () => _api(ref).approvalsInbox());
  return Loaded(asJson(r.data), r.at, stale: r.stale);
});

/// A file the person picked on the phone.
class PickedFile {
  const PickedFile({required this.name, required this.bytes, required this.contentType});
  final String name;
  final List<int> bytes;
  final String contentType;
}

String contentTypeOf(String name) {
  final n = name.toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/// Sends a file to the school's storage the way the web apps do (register, send the bytes, mark it complete) and
/// gives its id to attach.
Future<String> uploadFile(EduProApi api, ApiTransport t, PickedFile f) async {
  final r = asJson(
    await api.filesCreate(
      body: CreateUploadDto(
        fileName: f.name,
        contentType: f.contentType,
        sizeBytes: f.bytes.length,
        classification: 'internal',
      ),
    ),
  );
  final up = asJson(r['upload']);
  await t.upload(
    '${up['url']}',
    f.bytes,
    method: '${up['method'] ?? 'PUT'}',
    headers: {for (final e in asJson(up['headers']).entries) e.key: '${e.value}'},
  );
  final id = '${asJson(r['file'])['id']}';
  try {
    await api.filesComplete(id: id);
  } on ApiException catch (e) {
    // already complete (the local store finishes it on upload)
    if (e.status >= 500 || e.offline) rethrow;
  }
  return id;
}
