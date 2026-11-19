import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'common.dart';
import 'data.dart';

/// Who teaches the child, as the website's My teachers (apps/parent/app/(app)/teachers) on the phone's own screen:
/// the class teacher first, then each subject's teacher, with the photo, the subjects, the designation and the
/// contact the school shows (in full: a tap calls or writes; in part: shown as it is, with where to reach them).
class TeachersScreen extends ConsumerWidget {
  const TeachersScreen({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    return LoadedList<Json>(
      value: ref.watch(myTeachersProvider(profile)),
      refresh: () => ref.refresh(myTeachersProvider(profile).future),
      children: (d) {
        final child = d['child'] as Json?;
        final contact = asJson(d['contact']);
        final teachers = asList(child?['teachers']);
        final masked = contact['mobile'] == 'masked' || contact['email'] == 'masked';
        return [
          if (child != null)
            Text(
              [
                '${child['name'] ?? ''}',
                if (child['section'] != null) '${child['section']}',
              ].join(' · '),
              style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: Tokens.fwBold),
            ),
          Text(s.teachersHelp, style: TextStyle(color: muted, fontSize: 14)),
          const SizedBox(height: Tokens.sp4),
          if (child == null)
            Notice(text: s.notLinked)
          else if (teachers.isEmpty)
            EmptyLine(s.noTeachers)
          else ...[
            for (final t in teachers)
              _TeacherCard(
                teacher: t,
                callable: contact['mobile'] == 'full',
                writable: contact['email'] == 'full',
              ),
            if (masked) ...[
              const SizedBox(height: Tokens.sp2),
              Text(
                s.contactMasked,
                key: const Key('contactMasked'),
                style: TextStyle(color: muted, fontSize: 14),
              ),
            ],
          ],
        ];
      },
    );
  }
}

class _TeacherCard extends ConsumerWidget {
  const _TeacherCard({required this.teacher, required this.callable, required this.writable});
  final Json teacher;

  /// the school shows the number / the e-mail in full: a tap calls / writes
  final bool callable;
  final bool writable;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    final id = '${teacher['employeeId']}';
    final name = '${teacher['name'] ?? ''}';
    final role = '${teacher['role']}';
    final subjects = [for (final x in (teacher['subjects'] as List? ?? const [])) '$x'];
    final mobile = teacher['mobile'] as String?;
    final email = teacher['email'] as String?;
    Widget line(String label, String value) => Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Text.rich(
        TextSpan(
          children: [
            TextSpan(
              text: '$label: ',
              style: TextStyle(color: muted),
            ),
            TextSpan(text: value),
          ],
        ),
      ),
    );
    return Card(
      key: Key('teacher-$id'),
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _TeacherPhoto(employeeId: id, name: name, hasPhoto: teacher['hasPhoto'] == true),
            const SizedBox(width: Tokens.sp3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    name,
                    style: Theme.of(context).textTheme.titleMedium
                        ?.copyWith(fontWeight: Tokens.fwBold),
                  ),
                  const SizedBox(height: Tokens.sp1),
                  StatusChip(
                    s.teacherRole(role),
                    role == 'subject_teacher' ? Tone.neutral : Tone.info,
                  ),
                  if (subjects.isNotEmpty) line(s.subject, subjects.join(', ')),
                  if ('${teacher['designation'] ?? ''}'.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text('${teacher['designation']}', style: TextStyle(color: muted)),
                    ),
                  if (mobile != null)
                    callable
                        ? _Link(
                            key: Key('call-$id'),
                            icon: Icons.call_outlined,
                            text: mobile,
                            label: s.callWho(name),
                            uri: Uri(
                              scheme: 'tel',
                              path: mobile.replaceAll(RegExp(r'[^0-9+]'), ''),
                            ),
                          )
                        : line(s.mobileLabel, mobile),
                  if (email != null)
                    writable
                        ? _Link(
                            key: Key('mail-$id'),
                            icon: Icons.mail_outline,
                            text: email,
                            label: s.emailWho(name),
                            uri: Uri(scheme: 'mailto', path: email),
                          )
                        : line(s.emailLabel, email),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// The teacher's photo from the school, or their initials when there is none.
class _TeacherPhoto extends ConsumerWidget {
  const _TeacherPhoto({required this.employeeId, required this.name, required this.hasPhoto});
  final String employeeId;
  final String name;
  final bool hasPhoto;

  static const _size = 64.0;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final f = hasPhoto ? ref.watch(teacherPhotoProvider(employeeId)).value : null;
    final initials = name
        .split(RegExp(r'\s+'))
        .where((p) => p.isNotEmpty)
        .map((p) => p[0])
        .take(2)
        .join()
        .toUpperCase();
    return ExcludeSemantics(
      child: ClipRRect(
        borderRadius: BorderRadius.circular(Tokens.radiusLg),
        child: SizedBox.square(
          dimension: _size,
          child: f != null
              ? Image.memory(
                  Uint8List.fromList(f.bytes),
                  key: Key('teacherPhoto-$employeeId'),
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => _initials(initials),
                )
              : _initials(initials),
        ),
      ),
    );
  }

  Widget _initials(String text) => ColoredBox(
    color: Tokens.mobNavy800,
    child: Center(
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: Padding(
          padding: const EdgeInsets.all(Tokens.sp2),
          child: Text(
            text,
            style: const TextStyle(color: Tokens.mobWhite, fontSize: 22, fontWeight: Tokens.fwBold),
          ),
        ),
      ),
    ),
  );
}

/// A number or an e-mail address the school shows in full: a tap calls or writes from the phone.
class _Link extends StatelessWidget {
  const _Link({
    super.key,
    required this.icon,
    required this.text,
    required this.label,
    required this.uri,
  });
  final IconData icon;
  final String text;
  final String label;
  final Uri uri;

  @override
  Widget build(BuildContext context) => Semantics(
    label: label,
    excludeSemantics: true,
    button: true,
    child: TextButton.icon(
      style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: Tokens.sp1)),
      icon: Icon(icon, size: 18),
      label: Text(text),
      onPressed: () => launchUrl(uri),
    ),
  );
}
