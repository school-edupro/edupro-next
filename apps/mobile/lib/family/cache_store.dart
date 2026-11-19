import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Where the screens' last copies are kept (docs/design/89 §5.6).
abstract class CacheStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> clear();
}

/// The app's preferences (the web build, and tests). Small and simple; on Android one file loaded whole.
class PrefsCacheStore implements CacheStore {
  const PrefsCacheStore();
  static const prefix = 'cache:';

  @override
  Future<String?> read(String key) async =>
      (await SharedPreferences.getInstance()).getString('$prefix$key');

  @override
  Future<void> write(String key, String value) async =>
      (await SharedPreferences.getInstance()).setString('$prefix$key', value);

  @override
  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    for (final k in prefs.getKeys().where((k) => k.startsWith(prefix)).toList()) {
      await prefs.remove(k);
    }
  }
}

/// A file a copy in the app's own storage (phones): a slow phone reads only the screen it opens, not every copy at
/// once as with the preferences file.
class FileCacheStore implements CacheStore {
  /// [dir]: the folder (tests); otherwise `screens` in the app's support folder.
  FileCacheStore([this._dir]);
  Directory? _dir;

  Future<Directory> _folder() async {
    final d = _dir ??= Directory('${(await getApplicationSupportDirectory()).path}/screens');
    if (!await d.exists()) await d.create(recursive: true);
    return d;
  }

  Future<File> _file(String key) async =>
      File('${(await _folder()).path}/${sha1.convert(utf8.encode(key))}.json');

  @override
  Future<String?> read(String key) async {
    final f = await _file(key);
    return await f.exists() ? f.readAsString() : null;
  }

  @override
  Future<void> write(String key, String value) async {
    final f = await _file(key);
    // written whole, then put in place: a copy is never half written
    final tmp = File('${f.path}.tmp');
    await tmp.writeAsString(value, flush: true);
    await tmp.rename(f.path);
  }

  @override
  Future<void> clear() async {
    final d = await _folder();
    // the copies go; the folder stays for the next person's
    await for (final f in d.list()) {
      await f.delete(recursive: true);
    }
  }
}

/// The store in use: files on a phone (set at start-up), the preferences otherwise.
CacheStore cacheStore = const PrefsCacheStore();
