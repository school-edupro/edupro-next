import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/dio_transport.dart';
import '../app_services.dart';
import '../push/push.dart';

/// One way the person uses EduPro (GET /me/profiles): staff of a school, the parent of a child, a student.
class Profile {
  const Profile({
    required this.id,
    required this.kind,
    required this.schoolId,
    required this.schoolName,
    required this.name,
    required this.app,
    this.schoolCode,
    this.detail,
    this.studentId,
    this.actingAs,
  });

  factory Profile.fromJson(Map<String, dynamic> j) => Profile(
    id: '${j['id']}',
    kind: '${j['kind']}',
    schoolId: '${j['schoolId']}',
    schoolName: '${j['schoolName']}',
    schoolCode: j['schoolCode'] as String?,
    name: '${j['name']}',
    app: '${j['app']}',
    detail: j['detail'] as String?,
    studentId: j['studentId'] as String?,
    actingAs: j['actingAs'] as String?,
  );

  final String id;

  /// staff · parent · student
  final String kind;
  final String schoolId;
  final String schoolName;

  /// the school's code: its public logo (shown on the sign-in screens once the phone knows the school)
  final String? schoolCode;
  final String name;

  /// the web app its pages belong to: teacher · parent
  final String app;
  final String? detail;
  final String? studentId;

  /// `family` when the person is also staff in this school
  final String? actingAs;

  bool get isStaff => kind == 'staff';
  ProfileHeaders get headers => ProfileHeaders(schoolId: schoolId, actingAs: actingAs);

  /// One profile is one id (a fresh list from the API gives new objects for the same profiles).
  @override
  bool operator ==(Object other) => other is Profile && other.id == id;
  @override
  int get hashCode => id.hashCode;
}

class ProfilesState {
  const ProfilesState(this.all, this.current);
  final List<Profile> all;
  final Profile? current;
}

/// The person's profiles and the one in use (the last one used opens next time).
class ProfilesController extends AsyncNotifier<ProfilesState> {
  static const _key = 'profile';

  @override
  Future<ProfilesState> build() async {
    final r = await ref.read(apiProvider).meProfiles() as Map;
    final all = [
      for (final p in (r['data'] as List)) Profile.fromJson(Map<String, dynamic>.from(p as Map)),
    ];
    final prefs = await SharedPreferences.getInstance();
    final last = prefs.getString(_key);
    final current = all.where((p) => p.id == last).firstOrNull ?? all.firstOrNull;
    if (current != null) {
      ref.read(profileHeadersProvider.notifier).set(current.headers);
      ref.read(pushProvider).registerForCurrentSchool();
    }
    return ProfilesState(all, current);
  }

  Future<void> choose(Profile p) async {
    ref.read(profileHeadersProvider.notifier).set(p.headers);
    state = AsyncData(ProfilesState(state.value?.all ?? [p], p));
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, p.id);
    await ref.read(pushProvider).registerForCurrentSchool();
  }
}

final profilesProvider = AsyncNotifierProvider<ProfilesController, ProfilesState>(
  ProfilesController.new,
);

/// A screen of the profile's menu (the web apps' own menus, by the person's rights: GET /me/menu).
class MenuItem {
  const MenuItem({required this.href, required this.label, required this.icon, this.help});
  final String href;
  final String label;
  final String icon;
  final String? help;
}

class MenuGroup {
  const MenuGroup({required this.label, required this.icon, required this.items});
  final String label;
  final String icon;
  final List<MenuItem> items;
}

class ProfileMenu {
  const ProfileMenu({required this.app, required this.groups});
  final String app;
  final List<MenuGroup> groups;
}

final menuProvider = FutureProvider.family<ProfileMenu, String>((ref, profileId) async {
  final profiles = await ref.watch(profilesProvider.future);
  final p = profiles.all.firstWhere((x) => x.id == profileId);
  final r = await ref.read(apiProvider).meMenu(kind: p.kind) as Map;
  return ProfileMenu(
    app: '${r['app']}',
    groups: [
      for (final g in (r['groups'] as List).cast<Map>())
        if ((g['items'] as List).any((i) => (i as Map)['href'] != '/'))
          MenuGroup(
            label: '${g['label']}',
            icon: '${g['icon']}',
            items: [
              // Home is the app's own tab
              for (final i in (g['items'] as List).cast<Map>().where((i) => i['href'] != '/'))
                MenuItem(
                  href: '${i['href']}',
                  label: '${i['label']}',
                  icon: '${i['icon']}',
                  help: i['help'] as String?,
                ),
            ],
          ),
    ],
  );
});
