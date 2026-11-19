import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:edupro/api/api_transport.dart';

/// A recorded call to the API.
class Call {
  Call(this.method, this.path, this.body, this.query, this.headers);
  final String method;
  final String path;
  final Map<String, Object?>? body;
  final Map<String, Object?>? query;
  final Map<String, Object?> headers;
}

/// The API as a function of the call: what it answers, or an [ApiException] it throws.
typedef Answer = dynamic Function(Call call);

/// Stands in for the API behind the generated client (the screens' and controllers' tests).
class FakeTransport implements ApiTransport {
  FakeTransport(this.answer);
  final Answer answer;
  final List<Call> calls = [];

  @override
  Future<dynamic> send(
    String method,
    String path, {
    Map<String, Object?>? body,
    Map<String, Object?>? query,
  }) async {
    final c = Call(method, path, body, query, const {});
    calls.add(c);
    return answer(c);
  }

  @override
  Future<ApiFile> file(
    String method,
    String path, {
    Map<String, Object?>? body,
    Map<String, Object?>? query,
  }) async {
    final c = Call(method, path, body, query, const {});
    calls.add(c);
    final r = answer(c);
    return r is ApiFile
        ? r
        : const ApiFile(bytes: [37, 80, 68, 70], contentType: 'application/pdf', name: 'file.pdf');
  }

  @override
  Future<ApiFile> download(String url, {String? name, String? contentType}) async {
    final c = Call('GET', url, null, null, const {});
    calls.add(c);
    final r = answer(c);
    return r is ApiFile
        ? r
        : ApiFile(
            bytes: const [37, 80, 68, 70],
            contentType: 'application/pdf',
            name: name ?? 'file.pdf',
          );
  }
}

/// Stands in for the network under Dio (the transport's own tests): status and JSON a call gets.
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.answer);
  final (int, Object?) Function(RequestOptions o) answer;
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final (status, body) = answer(options);
    return ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}
