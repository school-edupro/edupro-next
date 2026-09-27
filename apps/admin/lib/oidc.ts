import * as client from 'openid-client';
import { env } from './env';

/**
 * One Auth OIDC client (authorization code flow with PKCE). Discovery is cached per server process.
 * openid-client v6 API.
 */
let configPromise: Promise<client.Configuration> | undefined;

export function oidcConfig(): Promise<client.Configuration> {
  if (!configPromise) {
    const { issuer, clientId, clientSecret } = env.oidc;
    configPromise = client.discovery(new URL(issuer), clientId, clientSecret);
  }
  return configPromise;
}

export interface LoginStart {
  url: string;
  codeVerifier: string;
  state: string;
  nonce: string;
}

export async function startLogin(returnTo: string): Promise<LoginStart> {
  const config = await oidcConfig();
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
  const state = client.randomState();
  const nonce = client.randomNonce();
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: env.oidc.redirectUri,
    scope: 'openid profile email',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
    // carry the post-login destination through state storage on our side, not in the URL
  });
  void returnTo;
  return { url: url.href, codeVerifier, state, nonce };
}

export interface LoginResult {
  sub: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  displayName?: string;
}

export async function completeLogin(
  currentUrl: URL,
  expected: { codeVerifier: string; state: string; nonce: string },
): Promise<LoginResult> {
  const config = await oidcConfig();
  const tokens = await client.authorizationCodeGrant(config, currentUrl, {
    pkceCodeVerifier: expected.codeVerifier,
    expectedState: expected.state,
    expectedNonce: expected.nonce,
  });
  const claims = tokens.claims();
  if (!claims?.sub) throw new Error('ID token has no subject');
  const expiresIn = typeof tokens.expires_in === 'number' ? tokens.expires_in : 3600;
  return {
    sub: claims.sub,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + expiresIn,
    displayName: typeof claims.name === 'string' ? claims.name : undefined,
  };
}

export async function logoutUrl(idTokenHint?: string): Promise<string | null> {
  const config = await oidcConfig();
  const meta = config.serverMetadata();
  if (!meta.end_session_endpoint) return null;
  const url = new URL(meta.end_session_endpoint);
  url.searchParams.set('client_id', env.oidc.clientId);
  url.searchParams.set('post_logout_redirect_uri', new URL('/login', env.oidc.redirectUri).href);
  if (idTokenHint) url.searchParams.set('id_token_hint', idTokenHint);
  return url.href;
}
