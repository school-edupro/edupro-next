import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';

import '../auth/session_store.dart';
import 'api_transport.dart';

/// The headers of the profile in use: its school, and `X-Acting-As: family` for a parent profile of a person
/// who is also staff in that school (docs/design/89 §5.1).
class ProfileHeaders {
  const ProfileHeaders({this.schoolId, this.actingAs});
  final String? schoolId;
  final String? actingAs;
}

/// Calls the API as the phone's session: the access token on every call, renewed with the refresh token a little
/// before it ends (or when the API says it has) — one renewal at a time, every waiting call then carries on. A
/// phone the API has signed out (another phone did it, the school did, an old token was played again) ends here.
/// A school file's signed link from the local store (`…/api/v1/platform/files/…?token=…`) fetched through the
/// app's own API address: the API names its own host (API_BASE_URL), which may not be how the phone reaches it (a
/// proxy in front, or the app's web preview, where another address is a cross-origin request the browser refuses —
/// photos and PDFs did not show). Other links (a storage service's) are left as they are.
String viaApiBase(String url, String baseUrl) {
  final u = Uri.tryParse(url);
  final b = Uri.tryParse(baseUrl);
  if (u == null || b == null || !u.path.startsWith('/api/v1/platform/files/')) return url;
  if (u.hasScheme && u.origin == b.origin) return url;
  return b.replace(path: u.path, query: u.hasQuery ? u.query : null).toString();
}

class DioTransport implements ApiTransport {
  DioTransport({
    required String baseUrl,
    required this.session,
    required this.deviceId,
    required this.appVersion,
    required this.profile,
    required this.onSignedOut,
    Dio? dio,
    Dio? refreshDio,
    Dio? plainDio,
  }) : _base = baseUrl,
       _dio = dio ?? Dio(),
       _refreshDio = refreshDio ?? Dio(),
       _plain = plainDio ?? Dio() {
    for (final d in [_dio, _refreshDio]) {
      d.options
        ..baseUrl = '$baseUrl/api/v1'
        ..connectTimeout = const Duration(seconds: 15)
        ..receiveTimeout = const Duration(seconds: 30)
        ..responseType = ResponseType.json;
    }
  }

  final String _base;
  final SessionStore session;
  final Future<String> Function() deviceId;
  final String appVersion;
  final ProfileHeaders Function() profile;
  final void Function() onSignedOut;
  final Dio _dio;
  final Dio _refreshDio;

  /// Signed file links (no session): a file's bytes up and down.
  final Dio _plain;
  Future<bool>? _renewing;

  /// The access token is renewed this long before it ends.
  static const _early = 60;

  bool get _fresh =>
      session.accessToken != null &&
      session.accessExpiresAt - _early > DateTime.now().millisecondsSinceEpoch ~/ 1000;

  @override
  Future<dynamic> send(
    String method,
    String path, {
    Map<String, Object?>? body,
    Map<String, Object?>? query,
  }) async {
    return (await _call(method, path, body, query, ResponseType.json)).data;
  }

  @override
  Future<ApiFile> file(
    String method,
    String path, {
    Map<String, Object?>? body,
    Map<String, Object?>? query,
  }) async {
    final r = await _call(method, path, body, query, ResponseType.bytes);
    final type = r.headers.value(Headers.contentTypeHeader) ?? 'application/octet-stream';
    final bytes = (r.data as List<int>?) ?? const <int>[];
    // some EduPro files come as JSON: the bytes in base64, or a short-lived signed link to fetch
    if (type.contains('json')) {
      final j = jsonDecode(utf8.decode(bytes)) as Map<String, dynamic>;
      if (j['base64'] is String) {
        return ApiFile(
          bytes: base64Decode(j['base64'] as String),
          contentType: '${j['contentType'] ?? 'application/octet-stream'}',
          name: '${j['filename'] ?? 'file'}',
        );
      }
      // `{url}`, `{downloadUrl}`, or an attachment's `{file: {name}, download: {url}}`
      final nested = j['download'] is Map ? j['download'] as Map : const {};
      final url = j['url'] ?? j['downloadUrl'] ?? nested['url'];
      if (url is String) {
        final f = j['file'] is Map ? j['file'] as Map : const {};
        return download(
          url,
          name: '${j['filename'] ?? j['name'] ?? f['name'] ?? f['originalName'] ?? ''}',
          contentType: '${j['contentType'] ?? f['contentType'] ?? ''}',
        );
      }
    }
    return ApiFile(bytes: bytes, contentType: type, name: _nameOf(r.headers) ?? 'file');
  }

  @override
  Future<ApiFile> download(String url, {String? name, String? contentType}) async {
    try {
      final f = await _plain.get<List<int>>(
        viaApiBase(url, _base),
        options: Options(responseType: ResponseType.bytes),
      );
      final type = f.headers.value(Headers.contentTypeHeader);
      return ApiFile(
        bytes: f.data ?? const [],
        contentType:
            type ??
            (contentType == null || contentType.isEmpty ? 'application/octet-stream' : contentType),
        name: _nameOf(f.headers) ?? (name == null || name.isEmpty ? 'file' : name),
      );
    } on DioException catch (e) {
      throw ApiException(
        e.response?.statusCode ?? 0,
        'download',
        e.message ?? 'The file could not be fetched.',
      );
    }
  }

  @override
  Future<void> upload(
    String url,
    List<int> bytes, {
    String method = 'PUT',
    Map<String, String>? headers,
  }) async {
    try {
      // the local store's link through the app's own API address, as downloads go: the address the API names
      // (localhost:4000) is not how a phone or the web preview reaches it — the browser refused the upload
      await _plain.request<void>(
        viaApiBase(url, _base),
        data: Stream.fromIterable([bytes]),
        options: Options(
          method: method,
          headers: {...?headers, Headers.contentLengthHeader: bytes.length},
        ),
      );
    } on DioException catch (e) {
      throw ApiException(
        e.response?.statusCode ?? 0,
        'upload',
        e.message ?? 'The file could not be sent.',
      );
    }
  }

  static String? _nameOf(Headers h) {
    final d = h.value('content-disposition');
    if (d == null) return null;
    final m = RegExp(r'''filename\*?=(?:UTF-8'')?"?([^";]+)"?''').firstMatch(d);
    return m == null ? null : Uri.decodeComponent(m.group(1)!);
  }

  Future<Response<dynamic>> _call(
    String method,
    String path,
    Map<String, Object?>? body,
    Map<String, Object?>? query,
    ResponseType type,
  ) async {
    if (!_fresh && await session.refreshToken != null) await renew();
    try {
      return await _once(method, path, body, query, type);
    } on ApiException catch (e) {
      // the token ended sooner than the phone's clock thought: renew once and try again
      if (e.status == 401 && e.type == 'unauthenticated' && await session.refreshToken != null) {
        if (await renew()) return _once(method, path, body, query, type);
      }
      if (e.type == 'auth.mobile_signed_out') await _signedOut();
      rethrow;
    }
  }

  Future<Response<dynamic>> _once(
    String method,
    String path,
    Map<String, Object?>? body,
    Map<String, Object?>? query,
    ResponseType type,
  ) async {
    final p = profile();
    final o = currentCallOptions();
    final school = o?.schoolId ?? p.schoolId;
    final acting = o == null ? p.actingAs : o.actingAs;
    final headers = <String, Object>{
      if (session.accessToken != null) 'Authorization': 'Bearer ${session.accessToken}',
      'X-School-Id': ?school,
      'X-Acting-As': ?acting,
      if (o?.idempotencyKey != null) 'Idempotency-Key': o!.idempotencyKey!,
    };
    try {
      return await _dio.request<dynamic>(
        path,
        data: body,
        queryParameters: query?.map((k, v) => MapEntry(k, v)),
        options: Options(method: method, headers: headers, responseType: type),
      );
    } on DioException catch (e) {
      throw _problem(e);
    }
  }

  /// One renewal at a time; true when the phone has a fresh access token afterwards.
  Future<bool> renew() => _renewing ??= _renew().whenComplete(() => _renewing = null);

  Future<bool> _renew() async {
    for (var attempt = 0; attempt < 2; attempt++) {
      final token = await session.refreshToken;
      if (token == null) return false;
      try {
        final r = await _refreshDio.post<Map<String, dynamic>>(
          '/auth/mobile/refresh',
          data: {'refreshToken': token, 'deviceId': await deviceId(), 'appVersion': appVersion},
        );
        final d = r.data!;
        await session.save(
          accessToken: d['accessToken'] as String,
          expiresAt: (d['expiresAt'] as num).toInt(),
          refreshToken: d['refreshToken'] as String,
          sessionId: d['sessionId'] as String?,
        );
        return true;
      } on DioException catch (e) {
        final p = _problem(e);
        // renewed a moment ago elsewhere (the app was reopened mid-renewal): the stored token is the newer one
        if (p.type == 'auth.mobile_superseded') {
          await Future<void>.delayed(const Duration(milliseconds: 500));
          continue;
        }
        if (p.status == 401) await _signedOut();
        if (p.offline) return false;
        return false;
      }
    }
    return false;
  }

  Future<void> _signedOut() async {
    await session.clear();
    onSignedOut();
  }

  static ApiException _problem(DioException e) {
    final r = e.response;
    if (r == null) {
      return const ApiException(0, 'offline', 'No connection. Check the internet and try again.');
    }
    var data = r.data;
    if (data is List<int>) {
      try {
        data = jsonDecode(utf8.decode(data));
      } catch (_) {
        data = null;
      }
    }
    if (data is Map) {
      return ApiException(
        r.statusCode ?? 0,
        '${data['type'] ?? 'request-error'}',
        '${data['detail'] ?? data['title'] ?? 'Something went wrong'}',
      );
    }
    return ApiException(r.statusCode ?? 0, 'request-error', 'Something went wrong');
  }
}
