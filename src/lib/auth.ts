import { SignJWT, jwtVerify } from "jose";
import { timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "lr_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

const isProd = () => process.env.NODE_ENV === "production";

/** Dev convenience: with no APP_PASSWORD set outside production, skip the login gate. */
export function authDisabled(): boolean {
  return !isProd() && !process.env.APP_PASSWORD;
}

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.length >= 16) return new TextEncoder().encode(secret);
  if (!isProd()) return new TextEncoder().encode("dev-only-insecure-session-secret");
  throw new Error("SESSION_SECRET must be set (16+ chars) in production");
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

/** Constant-time passphrase comparison. Fails closed if APP_PASSWORD is unset. */
export function checkPassword(input: string): boolean {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Only allow same-site relative redirects after login. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
