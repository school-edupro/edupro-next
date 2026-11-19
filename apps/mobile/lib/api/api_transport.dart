import 'dart:async';

/// What the generated client (endpoints.g.dart) calls: one request, its JSON answer.
abstract interface class ApiTransport {
  Future<dynamic> send(
    String method,
    String path, {
    Map<String, Object?>? body,
    Map<String, Object?>? query,
  });

  /// A call whose answer is a file (a report card, a receipt, an attachment).
  Future<ApiFile> file(
    String method,
    String path, {
    Map<String, Object?>? body,
    Map<String, Object?>? query,
  });

  /// A short-lived signed link the API gave (an attachment, a finished PDF): fetched without the session.
  Future<ApiFile> download(String url, {String? name, String? contentType});

  /// Sends a file's bytes to the signed upload link the API gave (`POST /platform/files`), without the session.
  Future<void> upload(
    String url,
    List<int> bytes, {
    String method = 'PUT',
    Map<String, String>? headers,
  });
}

/// A file the API sent: its bytes, type and name.
class ApiFile {
  const ApiFile({required this.bytes, required this.contentType, required this.name});
  final List<int> bytes;
  final String contentType;
  final String name;

  bool get isPdf => contentType.contains('pdf') || name.toLowerCase().endsWith('.pdf');
  bool get isImage => contentType.startsWith('image/');
}

/// The API refused or failed: its problem type (e.g. `auth.otp_wrong`) and the sentence to show.
class ApiException implements Exception {
  const ApiException(this.status, this.type, this.detail);

  final int status;
  final String type;
  final String detail;

  /// No network, or the API could not be reached.
  bool get offline => status == 0;

  @override
  String toString() => 'ApiException($status, $type, $detail)';
}

/// Headers for the calls made inside [withCall]: a write kept on the phone and sent later goes with the school it
/// was made in and its idempotency key (the API answers a repeat with the first answer instead of doing it twice).
class CallOptions {
  const CallOptions({this.schoolId, this.actingAs, this.idempotencyKey});
  final String? schoolId;
  final String? actingAs;
  final String? idempotencyKey;
}

const _callOptions = #eduproCallOptions;

/// Runs [body] with [options] for every API call it makes.
Future<T> withCall<T>(CallOptions options, Future<T> Function() body) =>
    runZoned(body, zoneValues: {_callOptions: options});

/// The options of the call being made (null outside [withCall]).
CallOptions? currentCallOptions() => Zone.current[_callOptions] as CallOptions?;
