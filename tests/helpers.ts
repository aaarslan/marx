export function makeJwt(claims: Record<string, unknown>): string {
  const b64 = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64(claims)}.`;
}
