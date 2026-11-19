import 'dart:async';
import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart' show ImagePicker, ImageSource;
import 'package:material_ui/material_ui.dart';

import '../api/api_transport.dart';
import '../api/endpoints.g.dart';
import '../app_services.dart';
import '../l10n/strings.dart';
import '../profiles/profiles.dart';
import '../staff/data.dart' show PickedFile, contentTypeOf, uploadFile;
import '../theme/tokens.g.dart';
import '../ui/widgets.dart';
import 'common.dart';
import 'data.dart';

/// The child's profile as the web app's Profile page has it, on the phone and with no web page (docs/design/89,
/// "Profile in the app"): the photo and facts, the parents, each section with Update (saved at once or sent for
/// approval, with the proofs the school asks for), the changes asked for (withdraw), the profile PDF, the
/// family's consents and the data-protection requests ("Your data"). A student sees their own.

// ---------------------------------------------------------------- the rules the web page uses

/// A value as families read it: dates as 30-09-2026.
String shownValue(Object? v) {
  if (v == null || v == '') return '';
  final s = '$v';
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(s);
  return m == null ? s : '${m[3]}-${m[2]}-${m[1]}';
}

String asText(Object? v) => v == null ? '' : '$v';

/// Whether a field applies to the current values (the API's rule: shown only when another field has a value).
bool appliesTo(Json f, Map<String, Object?> values) {
  final when = f['when'];
  if (when is! Map) return true;
  final v = values['${when['key']}'];
  final s = v == null ? '' : '$v';
  if (when['in'] is List) return (when['in'] as List).map((x) => '$x').contains(s);
  if (when['notIn'] is List) return !(when['notIn'] as List).map((x) => '$x').contains(s);
  return true;
}

/// Address groups: the state list follows the country, the city list follows the state.
const _cascades = [
  ['residential_country', 'residential_state', 'residential_city'],
  ['permanent_country', 'permanent_state', 'permanent_city'],
  ['father_office_country', 'father_office_state', 'father_office_city'],
  ['mother_office_country', 'mother_office_state', 'mother_office_city'],
  ['guardian_office_country', 'guardian_office_state', 'guardian_office_city'],
];

/// The options to offer for a field, narrowed by the country or state chosen in the same group (null: free text).
List<String>? optionsFor(Json f, Map<String, Object?> values, Json? geography) {
  if (f['options'] is! List) return null;
  final options = [for (final o in f['options'] as List) '$o'];
  final g = _cascades.where((x) => x.contains(f['key'])).firstOrNull;
  if (g == null || geography == null) return options;
  if (f['key'] == g[1]) {
    final country = asText(values[g[0]]);
    final states = asList(geography['states'])
        .where((s) => country.isEmpty || s['country'] == null || s['country'] == country)
        .toList();
    return states.isEmpty
        ? options
        : [
            for (final s in states)
              if (options.contains('${s['name']}')) '${s['name']}',
          ];
  }
  if (f['key'] == g[2]) {
    final state = asText(values[g[1]]);
    return state.isEmpty
        ? options
        : [
            for (final c in asList(geography['cities']))
              if (c['state'] == state) '${c['name']}',
          ];
  }
  return options;
}

bool _editable(Json f) => f['level'] == 'edit_approval' || f['level'] == 'edit_direct';

// ---------------------------------------------------------------- data

final portalProfileProvider = FutureProvider.autoDispose.family<Loaded<Json>, Profile>((
  ref,
  p,
) async {
  final r = await cached(
    'profile:${p.id}',
    () => ref.read(apiProvider).portalProfileProfile(studentId: p.studentId!),
  );
  return Loaded(asJson(r.data), r.at, stale: r.stale);
});

final profileRequestsProvider = FutureProvider.autoDispose.family<List<Json>, Profile>((
  ref,
  p,
) async {
  final r = asJson(await ref.read(apiProvider).portalProfileRequests(studentId: p.studentId!));
  return asList(r['data']);
});

/// The family's consents (what the school may send them), from the family view.
final familyConsentsProvider = FutureProvider.autoDispose.family<List<Json>, Profile>((
  ref,
  p,
) async {
  final r = asJson(await ref.read(apiProvider).engagementFamilyView());
  return asList(r['consents']);
});

/// A photo of the profile (student, father, mother, guardian) as bytes; null when there is none.
final profilePhotoProvider = FutureProvider.autoDispose
    .family<Uint8List?, (Profile, String, String)>((ref, args) async {
      final (p, party, _) = args;
      try {
        final r = asJson(
          await ref.read(apiProvider).portalProfilePhoto(studentId: p.studentId!, party: party),
        );
        final url = asJson(r['download'])['url'];
        if (url is! String) return null;
        final f = await ref.read(transportProvider).download(url, name: '$party.jpg');
        return Uint8List.fromList(f.bytes);
      } on ApiException catch (e) {
        if (e.status == 404) return null;
        rethrow;
      }
    });

final dataRequestsProvider = FutureProvider.autoDispose.family<List<Json>, Profile>((ref, p) async {
  return asList(asJson(await ref.read(apiProvider).dsrMine())['data']);
});

/// The family's children (for "About whom?").
final viewerChildrenProvider = FutureProvider.autoDispose.family<List<Json>, Profile>((
  ref,
  p,
) async {
  try {
    return asList(asJson(await ref.read(apiProvider).dailyWorkViewerInfo())['students']);
  } catch (_) {
    return const [];
  }
});

/// The profile PDF: the API prepares it (the background work), the phone waits up to [wait] and fetches it.
Future<ApiFile> profilePdf(
  EduProApi api,
  ApiTransport t,
  S s, {
  required String studentId,
  Duration every = const Duration(seconds: 2),
  Duration wait = const Duration(seconds: 60),
}) async {
  final id = '${asJson(await api.portalProfilePrint(studentId: studentId))['id']}';
  final until = DateTime.now().add(wait);
  while (true) {
    final st = asJson(await api.portalProfileExportStatus(id: id));
    final url = asJson(st['download'])['url'];
    if (url is String) {
      return t.download(url, name: 'profile.pdf', contentType: 'application/pdf');
    }
    if (asJson(st['export'])['status'] == 'failed') throw s.profilePdfFailed;
    if (DateTime.now().isAfter(until)) throw s.pdfPreparing;
    await Future<void>.delayed(every);
  }
}

String _apiError(S s, Object e) {
  if (e is ApiException) return e.offline ? s.offline : e.detail;
  return '$e';
}

// ---------------------------------------------------------------- the page

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  String? _message;
  String? _error;
  bool _busy = false;

  Profile get _p => widget.profile;

  void _refresh() {
    ref.invalidate(portalProfileProvider(_p));
    ref.invalidate(profileRequestsProvider(_p));
  }

  void _done(String? message, {String? error}) {
    if (!mounted) return;
    setState(() {
      _message = message;
      _error = error;
      _busy = false;
    });
  }

  Future<void> _run(Future<String?> Function() f) async {
    final s = ref.read(stringsProvider);
    setState(() => _busy = true);
    try {
      _done(await f());
    } catch (e) {
      _done(null, error: _apiError(s, e));
    }
  }

  /// A new photo: from the camera or the gallery, sent like the web page (5 MB, JPG / PNG / WebP).
  Future<void> _photo(String party) async {
    final s = ref.read(stringsProvider);
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      showDragHandle: true,
      builder: (c) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              key: const Key('photoCamera'),
              leading: const Icon(Icons.photo_camera_outlined),
              title: Text(s.takePhoto),
              onTap: () => Navigator.of(c).pop(ImageSource.camera),
            ),
            ListTile(
              key: const Key('photoGallery'),
              leading: const Icon(Icons.photo_library_outlined),
              title: Text(s.pickPhoto),
              onTap: () => Navigator.of(c).pop(ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;
    final x = await ImagePicker().pickImage(source: source, maxWidth: 1600, imageQuality: 85);
    if (x == null) return;
    final bytes = await x.readAsBytes();
    final type = x.mimeType ?? contentTypeOf(x.name);
    if (!RegExp(r'^image/(png|jpeg|webp)$').hasMatch(type)) {
      return _done(null, error: s.photoTypeWrong);
    }
    if (bytes.length > 5 * 1024 * 1024) return _done(null, error: s.photoTooBig);
    await _run(() async {
      final api = ref.read(apiProvider);
      final id = await uploadFile(
        api,
        ref.read(transportProvider),
        PickedFile(name: x.name, bytes: bytes, contentType: type),
        classification: 'personal',
      );
      final r = asJson(
        await api.portalProfileSubmit(
          studentId: _p.studentId!,
          body: SubmitPortalChangesDto(changes: {'photo_$party': id}, proofs: const []),
        ),
      );
      _refresh();
      ref.invalidate(profilePhotoProvider);
      return ((r['pending'] as List?)?.isNotEmpty ?? false) ? s.photoSent : s.photoSaved;
    });
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final p = _p;
    return LoadedList<Json>(
      value: ref.watch(portalProfileProvider(p)),
      refresh: () {
        ref.invalidate(profileRequestsProvider(p));
        ref.invalidate(familyConsentsProvider(p));
        return ref.refresh(portalProfileProvider(p).future);
      },
      children: (pr) => [
        if (_message != null) ...[Notice(text: _message!), const SizedBox(height: Tokens.sp3)],
        if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp3)],
        _Hero(
          profile: p,
          data: pr,
          busy: _busy,
          onPhoto: _photo,
          pending: (ref.watch(profileRequestsProvider(p)).value ?? const [])
              .where((r) => r['status'] == 'pending')
              .length,
        ),
        ..._window(s, asJson(pr['window'])),
        ..._requests(s),
        for (final sec in asList(pr['sections'])) ..._section(s, pr, sec),
        const SizedBox(height: Tokens.sp3),
        Card(
          child: ListTile(
            key: const Key('yourData'),
            leading: const Icon(Icons.shield_outlined),
            title: Text(s.yourData),
            subtitle: Text(s.yourDataHelp),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => pushPage(context, s.yourData, YourDataScreen(profile: p)),
          ),
        ),
        ..._consents(s),
      ],
    );
  }

  List<Widget> _window(S s, Json w) {
    if (w['open'] == false) return [Notice(text: '${w['message'] ?? s.updatesClosed}')];
    if (w['message'] != null || w['until'] != null) {
      return [
        Notice(
          text: [
            if (w['message'] != null) '${w['message']}',
            if (w['until'] != null) s.updatesOpenUntil(shownValue(w['until'])),
          ].join(' '),
        ),
      ];
    }
    return const [];
  }

  List<Widget> _requests(S s) {
    final reqs = ref.watch(profileRequestsProvider(_p)).value ?? const <Json>[];
    if (reqs.isEmpty) return const [];
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    return [
      SectionTitle(s.changeRequests, key: const Key('changeRequests')),
      Card(
        child: Column(
          children: [
            for (final r in reqs)
              Padding(
                padding: const EdgeInsets.all(Tokens.sp4),
                child: Column(
                  key: Key('request-${r['id']}'),
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            s.date(r['createdAt']),
                            style: const TextStyle(fontWeight: Tokens.fwBold),
                          ),
                        ),
                        StatusChip(s.requestStatus('${r['status']}'), switch ('${r['status']}') {
                          'approved' => Tone.success,
                          'rejected' => Tone.danger,
                          'pending' => Tone.warning,
                          _ => Tone.neutral,
                        }),
                      ],
                    ),
                    for (final it in asList(r['items']))
                      Text(
                        '${it['label']}: ${shownValue(it['to']).isEmpty ? s.cleared : shownValue(it['to'])}'
                        '${it['status'] == 'pending' ? '' : ' · ${s.requestStatus('${it['status']}')}'}'
                        '${it['note'] != null ? ' · ${it['note']}' : ''}',
                      ),
                    if (r['status'] == 'pending' && r['waitingFor'] != null)
                      Text(s.waitingWith('${r['waitingFor']}'), style: TextStyle(color: muted)),
                    if (r['decisionNote'] != null)
                      Text('${r['decisionNote']}', style: TextStyle(color: muted)),
                    if (r['status'] == 'pending' && r['mine'] == true)
                      Align(
                        alignment: AlignmentDirectional.centerEnd,
                        child: TextButton(
                          key: Key('withdraw-${r['id']}'),
                          onPressed: _busy
                              ? null
                              : () => _run(() async {
                                  await ref.read(apiProvider).portalProfileCancel(id: '${r['id']}');
                                  _refresh();
                                  return s.requestWithdrawn;
                                }),
                          child: Text(s.withdraw),
                        ),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    ];
  }

  List<Widget> _section(S s, Json pr, Json sec) {
    final all = [for (final x in asList(pr['sections'])) ...asList(x['fields'])];
    final values = {for (final f in all) '${f['key']}': f['value']};
    final fields = asList(sec['fields']).where((f) => appliesTo(f, values)).toList();
    if (fields.isEmpty) return const [];
    final open = asJson(pr['window'])['open'] != false;
    final editable = open && fields.any(_editable);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    return [
      SectionTitle(
        '${sec['title']}',
        key: Key('section-${sec['id']}'),
        action: editable
            ? TextButton(
                key: Key('update-${sec['id']}'),
                onPressed: () async {
                  final msg = await Navigator.of(context).push<String>(
                    MaterialPageRoute(
                      builder: (_) => FamilyPage(
                        title: s.updateSection('${sec['title']}'),
                        child: ProfileEditScreen(profile: _p, data: pr, sectionId: '${sec['id']}'),
                      ),
                    ),
                  );
                  if (msg != null) {
                    _refresh();
                    _done(msg);
                  }
                },
                child: Semantics(label: s.updateSection('${sec['title']}'), child: Text(s.update)),
              )
            : null,
      ),
      Card(
        child: Padding(
          padding: const EdgeInsets.all(Tokens.sp4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final f in fields)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: Tokens.sp1),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${f['label']}', style: TextStyle(color: muted, fontSize: 14)),
                      Text(
                        shownValue(f['value']).isEmpty ? s.notGiven : shownValue(f['value']),
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: Tokens.fwSemibold,
                          color: shownValue(f['value']).isEmpty ? muted : null,
                        ),
                      ),
                      if (f['pending'] is Map)
                        Wrap(
                          spacing: Tokens.sp2,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            Tag(s.waitingForApproval, color: Tokens.statusWarningBg),
                            Text(
                              shownValue(asJson(f['pending'])['to']).isEmpty
                                  ? s.cleared
                                  : shownValue(asJson(f['pending'])['to']),
                            ),
                          ],
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    ];
  }

  List<Widget> _consents(S s) {
    final consents = ref.watch(familyConsentsProvider(_p)).value ?? const <Json>[];
    if (consents.isEmpty) return const [];
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    return [
      SectionTitle(s.yourConsents),
      Text(s.consentsHelp, style: TextStyle(color: muted, fontSize: 14)),
      const SizedBox(height: Tokens.sp2),
      Card(
        child: Column(
          children: [
            for (final c in consents)
              Padding(
                padding: const EdgeInsets.fromLTRB(Tokens.sp4, Tokens.sp3, Tokens.sp2, Tokens.sp3),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Wrap(
                            spacing: Tokens.sp2,
                            runSpacing: Tokens.sp1,
                            crossAxisAlignment: WrapCrossAlignment.center,
                            children: [
                              Text(
                                '${c['name']}',
                                style: const TextStyle(fontWeight: Tokens.fwBold),
                              ),
                              StatusChip(
                                s.consentStatus(c['status'] as String?),
                                switch (c['status']) {
                                  'granted' => Tone.success,
                                  'withdrawn' => Tone.danger,
                                  _ => Tone.neutral,
                                },
                              ),
                            ],
                          ),
                          if (c['description'] != null)
                            Text('${c['description']}', style: TextStyle(color: muted)),
                        ],
                      ),
                    ),
                    TextButton(
                      key: Key('consent-${c['code']}'),
                      onPressed: _busy || (c['isRequired'] == true && c['status'] == 'granted')
                          ? null
                          : () => _run(() async {
                              await ref
                                  .read(apiProvider)
                                  .commsConsentsRecordSelf(
                                    body: SelfConsentDto(
                                      purposeCode: '${c['code']}',
                                      status: c['status'] == 'granted' ? 'withdrawn' : 'granted',
                                    ),
                                  );
                              ref.invalidate(familyConsentsProvider(_p));
                              return s.consentRecorded;
                            }),
                      child: Semantics(
                        label: c['status'] == 'granted'
                            ? s.withdrawWhat('${c['name']}')
                            : s.allowWhat('${c['name']}'),
                        excludeSemantics: true,
                        child: Text(c['status'] == 'granted' ? s.withdraw : s.allow),
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    ];
  }
}

/// The photo and the facts, the PDF and what waits for approval; the parents (a parent's profile).
class _Hero extends ConsumerWidget {
  const _Hero({
    required this.profile,
    required this.data,
    required this.busy,
    required this.onPhoto,
    required this.pending,
  });
  final Profile profile;
  final Json data;
  final bool busy;
  final void Function(String party) onPhoto;
  final int pending;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final p = profile;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    final photos = asJson(data['photos']);
    final versions = asJson(data['photoVersions']);
    final enrol = asJson(data['enrolment']);
    final all = [for (final x in asList(data['sections'])) ...asList(x['fields'])];
    Object? fact(String key) => all.where((f) => f['key'] == key).firstOrNull?['value'];
    final open = asJson(data['window'])['open'] != false;

    /// Add / Change photo, or the request already waiting
    Widget? photoControl(String party, bool has) {
      final pf = asList(data['photoFields']).where((x) => x['party'] == party).firstOrNull;
      if (pf == null) return null;
      if (pf['pending'] is Map) {
        return Text(s.photoWaiting, style: TextStyle(color: muted, fontSize: 13));
      }
      if (!open || !_editable(pf)) return null;
      return TextButton(
        key: Key('photo-$party'),
        onPressed: busy ? null : () => onPhoto(party),
        child: Text(has ? s.changePhoto : s.addPhoto),
      );
    }

    final parents = <(String, String, Object?, Object?)>[
      ('father', s.father, fact('father_name'), fact('father_mobile')),
      ('mother', s.mother, fact('mother_name'), fact('mother_mobile')),
      if (fact('guardian_name') != null)
        ('guardian', s.guardian, fact('guardian_name'), fact('guardian_mobile')),
    ];
    final completeness = (data['completeness'] as num? ?? 0).toInt();
    // large text: the photo above the facts (beside them it leaves the facts no room)
    final big = MediaQuery.textScalerOf(context).scale(10) > 13;
    Widget facts(Widget child) => big ? child : Expanded(child: child);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(Tokens.sp4),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Flex(
              direction: big ? Axis.vertical : Axis.horizontal,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Column(
                  children: [
                    _Photo(
                      profile: p,
                      party: 'student',
                      has: photos['student'] == true,
                      version: '${versions['student'] ?? ''}',
                      label: '${data['name']}',
                      size: 88,
                    ),
                    ?photoControl('student', photos['student'] == true),
                  ],
                ),
                const SizedBox(width: Tokens.sp4, height: Tokens.sp3),
                facts(
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('${data['name']}', style: Theme.of(context).textTheme.titleLarge),
                      if (data['enrolment'] != null)
                        FactLine(
                          s.classLabel,
                          '${enrol['className']} ${enrol['section']}'
                          '${enrol['rollNo'] != null ? ' · ${s.rollNo} ${enrol['rollNo']}' : ''}',
                        ),
                      FactLine(s.admissionNoLabel, '${data['admissionNo']}'),
                      if (data['classTeacher'] != null)
                        FactLine(s.classTeacher, '${data['classTeacher']}'),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: Tokens.sp3),
            Text('${s.profileComplete} $completeness%', style: TextStyle(color: muted)),
            const SizedBox(height: Tokens.sp1),
            Semantics(
              label: '${s.profileComplete} $completeness%',
              excludeSemantics: true,
              child: LinearProgressIndicator(
                value: completeness / 100,
                minHeight: 8,
                borderRadius: BorderRadius.circular(4),
              ),
            ),
            const SizedBox(height: Tokens.sp3),
            Wrap(
              spacing: Tokens.sp2,
              runSpacing: Tokens.sp2,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Flexible(
                      child: Text(
                        s.profilePdf,
                        style: const TextStyle(fontWeight: Tokens.fwSemibold),
                      ),
                    ),
                    FileIcons(
                      name: 'profilePdf',
                      label: s.profilePdf,
                      load: () => profilePdf(
                        ref.read(apiProvider),
                        ref.read(transportProvider),
                        s,
                        studentId: p.studentId!,
                      ),
                    ),
                  ],
                ),
                if (pending > 0) Tag(s.waitingForApprovalN(pending), color: Tokens.statusWarningBg),
              ],
            ),
            if (data['audience'] == 'parent') ...[
              const Divider(height: Tokens.sp6),
              for (final (party, label, name, mobile) in parents)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: Tokens.sp2),
                  child: Row(
                    children: [
                      _Photo(
                        profile: p,
                        party: party,
                        has: photos[party] == true,
                        version: '${versions[party] ?? ''}',
                        label: label,
                        size: 56,
                      ),
                      const SizedBox(width: Tokens.sp3),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(label, style: TextStyle(color: muted, fontSize: 13)),
                            Text(
                              name == null ? '—' : '$name',
                              style: const TextStyle(fontWeight: Tokens.fwBold),
                            ),
                            if (mobile != null) Text('$mobile'),
                            if (name != null) ?photoControl(party, photos[party] == true),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Photo extends ConsumerWidget {
  const _Photo({
    required this.profile,
    required this.party,
    required this.has,
    required this.version,
    required this.label,
    required this.size,
  });
  final Profile profile;
  final String party;
  final bool has;
  final String version;
  final String label;
  final double size;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final bytes = has ? ref.watch(profilePhotoProvider((profile, party, version))).value : null;
    final initials = label
        .split(RegExp(r'\s+'))
        .where((w) => w.isNotEmpty)
        .take(2)
        .map((w) => w[0].toUpperCase())
        .join();
    return Semantics(
      label: s.photoOf(label),
      image: true,
      excludeSemantics: true,
      child: Container(
        key: Key('photoBox-$party'),
        width: size,
        height: size * 1.15,
        clipBehavior: Clip.antiAlias,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: dark ? Tokens.mobNavy700 : Tokens.mobNavy50,
          borderRadius: BorderRadius.circular(Tokens.radiusMd),
          border: Border.all(color: Tokens.mobCyan600, width: 1.5),
        ),
        child: bytes != null
            ? Image.memory(bytes, fit: BoxFit.cover, width: size, height: size * 1.15)
            : Text(
                initials.isEmpty ? '?' : initials,
                style: TextStyle(
                  fontSize: size * 0.32,
                  fontWeight: Tokens.fwSemibold,
                  color: dark ? Tokens.mobWhite : Tokens.mobNavy800,
                ),
              ),
      ),
    );
  }
}

// ---------------------------------------------------------------- Update a section

/// One section's editable fields: each saved at once or sent for approval, the proofs the school asks for, a
/// reason; only the fields changed are sent.
class ProfileEditScreen extends ConsumerStatefulWidget {
  const ProfileEditScreen({
    super.key,
    required this.profile,
    required this.data,
    required this.sectionId,
  });
  final Profile profile;
  final Json data;
  final String sectionId;

  @override
  ConsumerState<ProfileEditScreen> createState() => _ProfileEditScreenState();
}

class _ProfileEditScreenState extends ConsumerState<ProfileEditScreen> {
  late final Json _section = asList(widget.data['sections'])
      .firstWhere((x) => '${x['id']}' == widget.sectionId, orElse: () => <String, dynamic>{});
  late final List<Json> _fields = asList(_section['fields']).where(_editable).toList();
  late final Map<String, Object?> _context = {
    for (final x in asList(widget.data['sections']))
      for (final f in asList(x['fields'])) '${f['key']}': f['value'],
  };
  late final Map<String, TextEditingController> _text = {
    for (final f in _fields) '${f['key']}': TextEditingController(text: asText(f['value'])),
  };
  final _reason = TextEditingController();
  final _proofs = <String, PickedFile>{};
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    for (final c in _text.values) {
      c.addListener(() => setState(() {}));
    }
  }

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    _reason.dispose();
    super.dispose();
  }

  Map<String, Object?> get _values => {
    ..._context,
    for (final e in _text.entries) e.key: e.value.text,
  };

  List<Json> get _changed => [
    for (final f in _fields)
      if (f['pending'] is! Map &&
          appliesTo(f, _values) &&
          _text['${f['key']}']!.text.trim() != asText(f['value']).trim())
        f,
  ];

  /// proof kind → the labels of the changed fields that need it
  Map<String, List<String>> get _needed {
    final need = <String, List<String>>{};
    for (final f in _changed) {
      if (f['proof'] != null) (need['${f['proof']}'] ??= []).add('${f['label']}');
    }
    return need;
  }

  Future<void> _pickProof(String kind) async {
    final picked = await FilePicker.pickFiles(
      type: FileType.custom,
      allowedExtensions: const ['pdf', 'jpg', 'jpeg', 'png', 'webp'],
    );
    final f = picked.firstOrNull;
    if (f == null) return;
    final bytes = await f.readAsBytes();
    setState(
      () => _proofs[kind] = PickedFile(
        name: f.name,
        bytes: bytes,
        contentType: contentTypeOf(f.name),
      ),
    );
  }

  Future<void> _date(Json f) async {
    final c = _text['${f['key']}']!;
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: DateTime.tryParse(c.text) ?? now,
      firstDate: DateTime(1900),
      lastDate: DateTime(now.year + 5),
    );
    if (picked != null) {
      c.text =
          '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
    }
  }

  Future<void> _send() async {
    final s = ref.read(stringsProvider);
    final changed = _changed;
    if (changed.isEmpty) return setState(() => _error = s.nothingChanged);
    if (_needed.keys.any((k) => !_proofs.containsKey(k))) {
      return setState(() => _error = s.proofNeeded);
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final api = ref.read(apiProvider);
      final t = ref.read(transportProvider);
      final proofs = <SubmitPortalChangesDtoProofsItem>[
        for (final kind in _needed.keys)
          SubmitPortalChangesDtoProofsItem(
            kind: kind,
            fileId: await uploadFile(api, t, _proofs[kind]!, classification: 'personal'),
          ),
      ];
      final r = asJson(
        await api.portalProfileSubmit(
          studentId: widget.profile.studentId!,
          body: SubmitPortalChangesDto(
            changes: {for (final f in changed) '${f['key']}': _text['${f['key']}']!.text.trim()},
            reason: _reason.text.trim().isEmpty ? null : _reason.text.trim(),
            proofs: proofs,
          ),
        ),
      );
      final pending = ((r['pending'] as List?)?.isNotEmpty ?? false);
      final applied = (r['applied'] as List?)?.isNotEmpty ?? false;
      if (mounted) {
        Navigator.of(context)
            .pop(pending ? (applied ? s.changesBoth : s.changesSent) : s.changesSaved);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = _apiError(s, e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    final values = _values;
    final kinds = {
      for (final k in asList(widget.data['proofKinds'])) '${k['id']}': '${k['label']}',
    };
    return ListView(
      key: const Key('profileEdit'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        for (final f in _fields)
          if (appliesTo(f, values)) _field(s, f, values, muted),
        for (final e in _needed.entries)
          Padding(
            padding: const EdgeInsets.only(top: Tokens.sp3),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(Tokens.sp3),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${s.proofOf(kinds[e.key] ?? e.key)} *',
                      style: const TextStyle(fontWeight: Tokens.fwBold),
                    ),
                    Text(s.proofFor(e.value.join(', ')), style: TextStyle(color: muted)),
                    const SizedBox(height: Tokens.sp2),
                    OutlinedButton.icon(
                      key: Key('proof-${e.key}'),
                      icon: const Icon(Icons.attach_file),
                      label: Text(_proofs[e.key]?.name ?? s.chooseFile),
                      onPressed: _busy ? null : () => _pickProof(e.key),
                    ),
                  ],
                ),
              ),
            ),
          ),
        const SizedBox(height: Tokens.sp4),
        TextField(
          key: const Key('changeReason'),
          controller: _reason,
          maxLength: 500,
          maxLines: 3,
          minLines: 2,
          decoration: InputDecoration(labelText: s.changeReason),
        ),
        if (_error != null) ...[const SizedBox(height: Tokens.sp2), ErrorText(_error!)],
        const SizedBox(height: Tokens.sp3),
        FilledButton(
          key: const Key('sendChanges'),
          onPressed: _busy || _changed.isEmpty ? null : _send,
          child: Text(s.sendChanges),
        ),
      ],
    );
  }

  Widget _field(S s, Json f, Map<String, Object?> values, Color muted) {
    final key = '${f['key']}';
    final c = _text[key]!;
    final label = '${f['label']}${f['required'] == true ? ' *' : ''}';
    final tag = Tag(
      f['level'] == 'edit_direct' ? s.savedAtOnce : s.needsApproval,
      color: f['level'] == 'edit_direct' ? Tokens.statusSuccessBg : Tokens.statusWarningBg,
    );
    final changed = f['pending'] is! Map && c.text.trim() != asText(f['value']).trim();
    final type = '${f['type']}';
    final options = optionsFor(f, values, asJson(widget.data['geography']));
    Widget input;
    if (f['pending'] is Map) {
      input = TextField(
        key: Key('field-$key'),
        controller: TextEditingController(text: shownValue(asJson(f['pending'])['to'])),
        enabled: false,
        decoration: InputDecoration(labelText: label, helperText: s.pendingField),
      );
    } else if (type == 'date') {
      input = OutlinedButton.icon(
        key: Key('field-$key'),
        icon: const Icon(Icons.event),
        style: OutlinedButton.styleFrom(alignment: Alignment.centerLeft),
        label: Text('$label: ${c.text.isEmpty ? s.chooseDate : shownValue(c.text)}'),
        onPressed: _busy ? null : () => _date(f),
      );
    } else if (options != null && options.isNotEmpty) {
      // type to search, as every list in EduPro; a value not in the list may still be typed
      input = DropdownMenu<String>(
        key: Key('field-$key'),
        controller: c,
        label: Text(label),
        trailingIcon: dropArrow(label),
        selectedTrailingIcon: dropArrow(label, open: true),
        expandedInsets: EdgeInsets.zero,
        enableFilter: true,
        enableSearch: true,
        requestFocusOnTap: true,
        dropdownMenuEntries: [for (final o in options) DropdownMenuEntry(value: o, label: o)],
      );
    } else {
      const numeric = ['mobile', 'pin', 'year', 'number', 'digits12', 'digits11', 'account'];
      input = TextField(
        key: Key('field-$key'),
        controller: c,
        maxLength: 300,
        keyboardType: type == 'email'
            ? TextInputType.emailAddress
            : type == 'mobile'
            ? TextInputType.phone
            : numeric.contains(type)
            ? TextInputType.number
            : TextInputType.text,
        textCapitalization: f['upper'] == true
            ? TextCapitalization.characters
            : TextCapitalization.sentences,
        decoration: InputDecoration(labelText: label, counterText: ''),
      );
    }
    return Container(
      margin: const EdgeInsets.only(bottom: Tokens.sp3),
      padding: changed ? const EdgeInsets.all(Tokens.sp2) : EdgeInsets.zero,
      decoration: changed
          ? BoxDecoration(
              color: Theme.of(context).brightness == Brightness.dark
                  ? Tokens.mobNavy700
                  : Tokens.mobCyan50,
              borderRadius: BorderRadius.circular(Tokens.radiusMd),
            )
          : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          tag,
          const SizedBox(height: Tokens.sp1),
          input,
          if (f['help'] != null && f['pending'] is! Map)
            Text('${f['help']}', style: TextStyle(color: muted, fontSize: 13)),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------- Your data

/// Data-protection requests: a copy of the data, a correction or a grievance; the requests and their report.
class YourDataScreen extends ConsumerStatefulWidget {
  const YourDataScreen({super.key, required this.profile});
  final Profile profile;

  @override
  ConsumerState<YourDataScreen> createState() => _YourDataScreenState();
}

class _YourDataScreenState extends ConsumerState<YourDataScreen> {
  String _kind = 'access';
  String _about = '';
  final _detail = TextEditingController();
  bool _busy = false;
  String? _message;
  String? _error;

  @override
  void dispose() {
    _detail.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final s = ref.read(stringsProvider);
    if (_detail.text.trim().isEmpty) return setState(() => _error = s.detailsNeeded);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(apiProvider)
          .dsrCreateMine(
            body: MyDsrDto(
              kind: _kind,
              studentId: _about.isEmpty ? null : _about,
              detail: _detail.text.trim(),
            ),
          );
      _detail.clear();
      ref.invalidate(dataRequestsProvider(widget.profile));
      setState(() {
        _busy = false;
        _message = s.requestRecorded;
      });
    } catch (e) {
      setState(() {
        _busy = false;
        _error = _apiError(s, e);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(stringsProvider);
    final p = widget.profile;
    final dark = Theme.of(context).brightness == Brightness.dark;
    final muted = dark ? Tokens.mobGray300 : Tokens.textMuted;
    final children = ref.watch(viewerChildrenProvider(p)).value ?? const <Json>[];
    final requests = ref.watch(dataRequestsProvider(p));
    return ListView(
      key: const Key('yourDataScreen'),
      padding: const EdgeInsets.all(Tokens.sp4),
      children: [
        Text(s.yourDataLaw, style: TextStyle(color: muted, fontSize: 14)),
        const SizedBox(height: Tokens.sp4),
        if (_message != null) ...[Notice(text: _message!), const SizedBox(height: Tokens.sp3)],
        Card(
          child: Padding(
            padding: const EdgeInsets.all(Tokens.sp4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                DropdownMenu<String>(
                  key: const Key('dsrKind'),
                  label: Text(s.whatDoYouNeed),
                  initialSelection: _kind,
                  trailingIcon: dropArrow(s.whatDoYouNeed),
                  selectedTrailingIcon: dropArrow(s.whatDoYouNeed, open: true),
                  expandedInsets: EdgeInsets.zero,
                  enableFilter: true,
                  enableSearch: true,
                  requestFocusOnTap: true,
                  onSelected: (v) => setState(() => _kind = v ?? 'access'),
                  dropdownMenuEntries: [
                    for (final k in const ['access', 'correction', 'grievance'])
                      DropdownMenuEntry(value: k, label: s.dsrKind(k)),
                  ],
                ),
                const SizedBox(height: Tokens.sp3),
                DropdownMenu<String>(
                  key: const Key('dsrAbout'),
                  label: Text(s.aboutWhom),
                  initialSelection: _about,
                  trailingIcon: dropArrow(s.aboutWhom),
                  selectedTrailingIcon: dropArrow(s.aboutWhom, open: true),
                  expandedInsets: EdgeInsets.zero,
                  enableFilter: true,
                  enableSearch: true,
                  requestFocusOnTap: true,
                  onSelected: (v) => setState(() => _about = v ?? ''),
                  dropdownMenuEntries: [
                    DropdownMenuEntry(value: '', label: s.myself),
                    for (final c in children)
                      DropdownMenuEntry(value: '${c['id']}', label: '${c['name']}'),
                  ],
                ),
                const SizedBox(height: Tokens.sp3),
                TextField(
                  key: const Key('dsrDetail'),
                  controller: _detail,
                  maxLength: 2000,
                  minLines: 3,
                  maxLines: 6,
                  decoration: InputDecoration(labelText: s.details),
                ),
                if (_error != null) ...[ErrorText(_error!), const SizedBox(height: Tokens.sp2)],
                FilledButton(
                  key: const Key('dsrSend'),
                  onPressed: _busy ? null : _send,
                  child: Text(s.sendRequest),
                ),
              ],
            ),
          ),
        ),
        SectionTitle(s.yourRequests),
        switch (requests) {
          AsyncValue(:final value?) when value.isEmpty => EmptyLine(s.noRequests),
          AsyncValue(:final value?) => Card(
            child: Column(
              children: [
                for (final r in value)
                  Padding(
                    padding: const EdgeInsets.fromLTRB(
                      Tokens.sp4,
                      Tokens.sp3,
                      Tokens.sp2,
                      Tokens.sp3,
                    ),
                    child: Row(
                      key: Key('dsr-${r['id']}'),
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Wrap(
                                spacing: Tokens.sp2,
                                runSpacing: Tokens.sp1,
                                crossAxisAlignment: WrapCrossAlignment.center,
                                children: [
                                  Text(
                                    [
                                      s.dsrKindShort('${r['kind']}'),
                                      if (r['principal'] != null) '${r['principal']}',
                                    ].join(' · '),
                                    style: const TextStyle(fontWeight: Tokens.fwBold),
                                  ),
                                  StatusChip(
                                    '${r['status']}'.replaceAll('_', ' '),
                                    switch ('${r['status']}') {
                                      'completed' => Tone.success,
                                      'rejected' => Tone.danger,
                                      _ => Tone.warning,
                                    },
                                  ),
                                ],
                              ),
                              Text(
                                [
                                  s.receivedDue(s.date(r['receivedOn']), s.date(r['dueOn'])),
                                  if (r['outcome'] != null) '${r['outcome']}',
                                ].join(' · '),
                                style: TextStyle(color: muted, fontSize: 13),
                              ),
                            ],
                          ),
                        ),
                        if (r['status'] == 'completed' && r['exportId'] != null)
                          FileIcons(
                            name: 'dsr-${r['id']}',
                            label: s.dataReport,
                            load: () async {
                              final st = asJson(
                                await ref.read(apiProvider).dsrMyExport(id: '${r['id']}'),
                              );
                              final url = asJson(st['download'])['url'];
                              if (url is! String) throw s.pdfPreparing;
                              return ref
                                  .read(transportProvider)
                                  .download(
                                    url,
                                    name: 'data-report.pdf',
                                    contentType: 'application/pdf',
                                  );
                            },
                          ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          AsyncValue(:final error?) => ErrorText(_apiError(s, error)),
          _ => const LinearProgressIndicator(),
        },
      ],
    );
  }
}
