/// Build-time settings (`--dart-define`), so the same code builds for development, staging and the stores.
abstract final class AppConfig {
  /// The EduPro API (without /api/v1).
  static const apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:4000',
  );

  /// Push notifications: on once the EduPro Firebase project's files are in the build (docs/design/89 §10).
  static const pushEnabled = bool.fromEnvironment('PUSH', defaultValue: false);

  /// Crash reports (Sentry); empty: off.
  static const sentryDsn = String.fromEnvironment('SENTRY_DSN', defaultValue: '');

  /// The app's own version, sent with the phone's session.
  static const appVersion = String.fromEnvironment('APP_VERSION', defaultValue: '0.1.0');
}
