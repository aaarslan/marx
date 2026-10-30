import { describe, expect, it } from 'vitest';
import {
  apiBaseFromAccessToken,
  authEndpointFromApiKey,
  authEndpointFromTenant,
  clientIdFromApiKey,
  decodeJwtPayload
} from '../src/main/cxone/jwt';
import { makeJwt } from './helpers';

describe('jwt claim helpers', () => {
  it('decodes payloads', () => {
    const claims = decodeJwtPayload(makeJwt({ aud: 'x', azp: 'y' }));
    expect(claims).toEqual({ aud: 'x', azp: 'y' });
  });

  it('returns null for garbage', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
  });

  it('derives the auth endpoint from the aud claim', () => {
    const key = makeJwt({ aud: 'https://acme.iam.checkmarx.net/auth/realms/acme' });
    expect(authEndpointFromApiKey(key)).toBe(
      'https://acme.iam.checkmarx.net/auth/realms/acme/protocol/openid-connect/token'
    );
  });

  it('supports array aud claims', () => {
    const key = makeJwt({ aud: ['https://acme.iam.checkmarx.net/auth/realms/acme'] });
    expect(authEndpointFromApiKey(key)).toContain('openid-connect/token');
  });

  it('falls back to ast-app client id when azp is missing', () => {
    expect(clientIdFromApiKey(makeJwt({}))).toBe('ast-app');
    expect(clientIdFromApiKey(makeJwt({ azp: 'custom-client' }))).toBe('custom-client');
  });

  it('reads ast-base-url from the access token', () => {
    const token = makeJwt({ 'ast-base-url': 'https://acme.ast.checkmarx.net' });
    expect(apiBaseFromAccessToken(token)).toBe('https://acme.ast.checkmarx.net');
    expect(apiBaseFromAccessToken(makeJwt({}))).toBeNull();
  });

  it('builds a tenant fallback endpoint', () => {
    expect(authEndpointFromTenant('acme')).toBe(
      'https://acme.iam.checkmarx.net/auth/realms/acme/protocol/openid-connect/token'
    );
    expect(authEndpointFromTenant('')).toBeNull();
  });
});
