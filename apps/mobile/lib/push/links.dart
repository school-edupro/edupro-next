import '../profiles/profiles.dart';

/// Where a tapped notification (or a shared EduPro link) leads: a page of the web apps' (`/homework`,
/// `/leaves?tab=inbox&open=12`), and the school, child and kind of profile it is about (docs/design/89 §5.3).
class LinkTarget {
  const LinkTarget({required this.path, this.schoolId, this.studentId, this.kind, this.event});
  final String path;

  /// the kind of push (approvals, homework, fees …)
  final String? event;
  final String? schoolId;
  final String? studentId;

  /// staff · parent · student, when the notification says
  final String? kind;

  /// The target in a push's data (`link` or `url`, `schoolId`, `studentId`, `profile`); null without a page. A full
  /// address of an EduPro web app gives its path; any other address is not followed.
  static LinkTarget? fromData(Map<String, dynamic> data) {
    final raw = '${data['link'] ?? data['url'] ?? ''}'.trim();
    if (raw.isEmpty) return null;
    final u = Uri.tryParse(raw);
    // `//host/…` without a scheme is not a link of ours; a full address gives only its path (inside EduPro)
    if (u == null || (!u.hasScheme && u.hasAuthority)) return null;
    final path = u.path.isEmpty ? '/' : u.path;
    if (!path.startsWith('/') || path.startsWith('//')) return null;
    final full = u.hasQuery ? '$path?${u.query}' : path;
    String? s(String k) => data[k] == null || '${data[k]}'.isEmpty ? null : '${data[k]}';
    final event = s('event');
    return LinkTarget(
      path: full,
      schoolId: s('schoolId'),
      studentId: s('studentId'),
      event: event,
      // something waiting for a decision is staff work (a family's own answer decided is not)
      kind:
          s('profile') ?? (event == 'approvals' && !path.startsWith('/consents') ? 'staff' : null),
    );
  }

  /// The profile the page is about: the child's (as parent or as the student), the staff profile of the school, or
  /// the one in use when the notification does not say.
  Profile? profileIn(List<Profile> all, Profile? current) {
    bool school(Profile p) => schoolId == null || p.schoolId == schoolId;
    if (studentId != null) {
      final kids = all.where((p) => school(p) && p.studentId == studentId);
      return kids.where((p) => kind == null || p.kind == kind).firstOrNull ??
          kids.firstOrNull ??
          current;
    }
    if (kind == 'staff' || (kind == null && current != null && !school(current))) {
      return all.where((p) => school(p) && p.isStaff).firstOrNull ??
          all.where(school).firstOrNull ??
          current;
    }
    return current != null && school(current) ? current : all.where(school).firstOrNull ?? current;
  }
}

/// A staff member's approval push opens the Approvals inbox in the app (whatever page the web would show).
bool opensApprovals(LinkTarget t, Profile p) =>
    p.isStaff && t.event == 'approvals' && !t.path.startsWith('/consents');
