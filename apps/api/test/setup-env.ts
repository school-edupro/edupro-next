/** Defaults for e2e runs on a developer machine; CI sets the real values. */
process.env.NODE_ENV ??= 'test';
process.env.AUTH_DEV_BYPASS ??= '1';
process.env.DATABASE_URL ??= 'postgresql://edupro_app:edupro_app_dev@localhost:5432/edupro';
process.env.DATABASE_MIGRATOR_URL ??=
  'postgresql://edupro_migrator:edupro_migrator_dev@localhost:5432/edupro';
process.env.ONEAUTH_ISSUER ??= 'https://oneauth.example.test';
process.env.ONEAUTH_AUDIENCE ??= 'edupro-next';
process.env.ONEAUTH_JWKS_URL ??= 'https://oneauth.example.test/.well-known/jwks.json';
