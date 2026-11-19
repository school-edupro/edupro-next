import 'dart:async';
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import '../app_services.dart';
import 'api_transport.dart';
import 'endpoints.g.dart';

/// A write kept on the phone until the API has it (docs/design/89 §5.6): a class's attendance, a check-in. It is
/// recorded from the generated client (so the app still never writes a URL by hand) and sent with its own key as
/// `Idempotency-Key`, so sending it again after a lost answer never does it twice.
class OutboxItem {
  const OutboxItem({
    required this.key,
    required this.label,
    required this.method,
    required this.path,
    required this.schoolId,
    required this.at,
    this.body,
    this.query,
    this.actingAs,
    this.error,
  });

  factory OutboxItem.fromJson(Map<String, dynamic> j) => OutboxItem(
    key: '${j['key']}',
    label: '${j['label']}',
    method: '${j['method']}',
    path: '${j['path']}',
    schoolId: '${j['schoolId']}',
    at: DateTime.parse('${j['at']}'),
    body: j['body'] == null ? null : Map<String, Object?>.from(j['body'] as Map),
    query: j['query'] == null ? null : Map<String, Object?>.from(j['query'] as Map),
    actingAs: j['actingAs'] as String?,
    error: j['error'] as String?,
  );

  /// the idempotency key
  final String key;

  /// what the person sees in the list of unsent work ("VI-A attendance, 19 Nov")
  final String label;
  final String method;
  final String path;
  final Map<String, Object?>? body;
  final Map<String, Object?>? query;
  final String schoolId;
  final String? actingAs;
  final DateTime at;

  /// the API refused it (the class was locked meanwhile, …): kept, with the reason, until the person removes it
  final String? error;

  OutboxItem failed(String why) => OutboxItem(
    key: key,
    label: label,
    method: method,
    path: path,
    schoolId: schoolId,
    at: at,
    body: body,
    query: query,
    actingAs: actingAs,
    error: why,
  );

  Map<String, Object?> toJson() => {
    'key': key,
    'label': label,
    'method': method,
    'path': path,
    'body': body,
    'query': query,
    'schoolId': schoolId,
    'actingAs': actingAs,
    'at': at.toIso8601String(),
    'error': error,
  };
}

/// Records the call a generated method would make, without making it.
class _Recorder implements ApiTransport {
  String? method;
  String? path;
  Map<String, Object?>? body;
  Map<String, Object?>? query;

  @override
  Future<dynamic> send(
    String method,
    String path, {
    Map<String, Object?>? body,
    Map<String, Object?>? query,
  }) async {
    this.method = method;
    this.path = path;
    this.body = body;
    this.query = query;
    return null;
  }

  @override
  Future<ApiFile> file(
    String method,
    String path, {
    Map<String, Object?>? body,
    Map<String, Object?>? query,
  }) => throw UnsupportedError('a file is not kept for later');

  @override
  Future<ApiFile> download(String url, {String? name, String? contentType}) =>
      throw UnsupportedError('a download is not kept for later');

  @override
  Future<void> upload(
    String url,
    List<int> bytes, {
    String method = 'PUT',
    Map<String, String>? headers,
  }) => throw UnsupportedError('a file is not kept for later');
}

/// What happened to a write handed to the outbox.
enum Sent { now, later, refused }

/// The writes waiting on this phone, oldest first; sent in order whenever the API can be reached.
class Outbox extends Notifier<List<OutboxItem>> {
  static const _prefKey = 'outbox';
  Timer? _timer;

  @override
  List<OutboxItem> build() {
    ref.onDispose(() => _timer?.cancel());
    _load();
    return const [];
  }

  Future<void> _load() async {
    final raw = (await SharedPreferences.getInstance()).getString(_prefKey);
    if (raw == null) return;
    state = [
      for (final j in jsonDecode(raw) as List)
        OutboxItem.fromJson(Map<String, dynamic>.from(j as Map)),
    ];
    _schedule();
  }

  Future<void> _save() async {
    final prefs = await SharedPreferences.getInstance();
    if (state.isEmpty) {
      await prefs.remove(_prefKey);
    } else {
      await prefs.setString(_prefKey, jsonEncode([for (final i in state) i.toJson()]));
    }
    _schedule();
  }

  // while something waits, try again every minute (and when the app comes back, and on pull-to-refresh)
  void _schedule() {
    _timer?.cancel();
    _timer = state.any((i) => i.error == null)
        ? Timer.periodic(const Duration(minutes: 1), (_) => flush())
        : null;
  }

  /// Sends [call] now if the API can be reached; with no network keeps it and sends it later. A refusal from the
  /// API (a rule, a lock) is thrown at once, as for any call.
  Future<Sent> send({
    required String label,
    required String schoolId,
    String? actingAs,
    required Future<dynamic> Function(EduProApi api) call,
  }) async {
    final r = _Recorder();
    await call(EduProApi(r));
    final item = OutboxItem(
      key: const Uuid().v4(),
      label: label,
      method: r.method!,
      path: r.path!,
      body: r.body,
      query: r.query,
      schoolId: schoolId,
      actingAs: actingAs,
      at: DateTime.now(),
    );
    // in order: a newer write never overtakes an older one waiting for the same thing
    if (!state.any((i) => i.error == null)) {
      try {
        await _deliver(item);
        return Sent.now;
      } on ApiException catch (e) {
        if (!_retry(e)) rethrow;
      }
    }
    state = [...state, item];
    await _save();
    unawaited(flush());
    return Sent.later;
  }

  // no network, the server busy or failing, or the same write still being handled: try again later
  static bool _retry(ApiException e) =>
      e.offline || e.status >= 500 || e.status == 429 || e.type == 'idempotency.in_progress';

  Future<void> _deliver(OutboxItem i) => withCall(
    CallOptions(schoolId: i.schoolId, actingAs: i.actingAs, idempotencyKey: i.key),
    () => ref.read(transportProvider).send(i.method, i.path, body: i.body, query: i.query),
  );

  /// Sends what waits, oldest first; stops at the first that still cannot go (no network). Asked while a round
  /// runs, it waits for that round, which then goes round once more (a write added meanwhile is not left behind).
  Future<void> flush() {
    if (_running != null) {
      _again = true;
      return _running!;
    }
    return _running = _drain().whenComplete(() => _running = null);
  }

  Future<void>? _running;
  bool _again = false;

  Future<void> _drain() async {
    do {
      _again = false;
      while (true) {
        final i = state.where((x) => x.error == null).firstOrNull;
        if (i == null) break;
        try {
          await _deliver(i);
          state = [
            for (final x in state)
              if (x.key != i.key) x,
          ];
        } on ApiException catch (e) {
          if (_retry(e)) break;
          state = [for (final x in state) x.key == i.key ? x.failed(e.detail) : x];
        }
        await _save();
      }
    } while (_again);
  }

  /// The person removes an item the API refused (or gives up on one waiting).
  Future<void> remove(String key) async {
    state = [
      for (final x in state)
        if (x.key != key) x,
    ];
    await _save();
  }

  /// At sign-out: what waits belongs to the person signing out.
  Future<void> clear() async {
    state = const [];
    await _save();
  }
}

final outboxProvider = NotifierProvider<Outbox, List<OutboxItem>>(Outbox.new);
