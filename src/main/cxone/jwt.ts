/** Minimal JWT payload decode (no verification — claims are used for discovery only). */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf-8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * The API key is a Keycloak refresh-token JWT whose `aud` claim carries the
 * realm URL, e.g. https://<tenant>.iam.checkmarx.net/auth/realms/<tenant>.
 * Returns the token endpoint derived from it, or null when not self-describing.
 */
export function authEndpointFromApiKey(apiKey: string): string | null {
  const claims = decodeJwtPayload(apiKey);
  const aud = claims?.aud;
  const realm = Array.isArray(aud) ? (aud[0] as string) : (aud as string);
  if (typeof realm === 'string' && realm.startsWith('http')) {
    return `${realm.replace(/\/+$/, '')}/protocol/openid-connect/token`;
  }
  return null;
}

/** The azp claim names the OAuth client to use when exchanging the API key. */
export function clientIdFromApiKey(apiKey: string): string {
  const claims = decodeJwtPayload(apiKey);
  const azp = claims?.azp;
  return typeof azp === 'string' && azp ? azp : 'ast-app';
}

/** The exchanged access token carries the AST API base URL. */
export function apiBaseFromAccessToken(accessToken: string): string | null {
  const claims = decodeJwtPayload(accessToken);
  const base = claims?.['ast-base-url'];
  return typeof base === 'string' && base.startsWith('http') ? base.replace(/\/+$/, '') : null;
}

/** Fallback: build the token endpoint from an explicit tenant + region host. */
export function authEndpointFromTenant(tenant: string): string | null {
  if (!tenant) return null;
  return `https://${tenant}.iam.checkmarx.net/auth/realms/${tenant}/protocol/openid-connect/token`;
}
