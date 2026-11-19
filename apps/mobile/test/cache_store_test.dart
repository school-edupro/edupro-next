import 'dart:io';

import 'package:edupro/api/api_transport.dart';
import 'package:edupro/family/cache_store.dart';
import 'package:edupro/family/data.dart';
import 'package:flutter_test/flutter_test.dart';

/// The screens' last copies in a file each on a phone (phase D: a slow phone reads only the copy it shows).
void main() {
  late Directory dir;
  setUp(() async {
    dir = await Directory.systemTemp.createTemp('edupro-cache');
    cacheStore = FileCacheStore(dir);
  });
  tearDown(() async {
    cacheStore = const PrefsCacheStore();
    await dir.delete(recursive: true);
  });

  test(
    'a copy a file, named so no key can reach outside the folder; read back with no network',
    () async {
      await cached('fees:parent:7:41', () async => {'balance': '12500.00'});
      await cached('../../etc/passwd', () async => {'x': 1});
      final files = dir.listSync().map((f) => f.uri.pathSegments.last).toList();
      expect(files, hasLength(2));
      expect(files.every((f) => RegExp(r'^[0-9a-f]{40}\.json$').hasMatch(f)), isTrue);
      final again = await cached(
        'fees:parent:7:41',
        () async => throw const ApiException(0, 'offline', 'No connection'),
      );
      expect(again.stale, isTrue);
      expect(again.data, {'balance': '12500.00'});
    },
  );

  test('sign-out wipes every copy', () async {
    await cached('a:1', () async => 1);
    await cached('b:2', () async => 2);
    await clearCache();
    expect(dir.listSync(), isEmpty);
    expect(
      () => cached('a:1', () async => throw const ApiException(0, 'offline', 'No connection')),
      throwsA(isA<ApiException>()),
    );
  });
}
