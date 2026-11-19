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
