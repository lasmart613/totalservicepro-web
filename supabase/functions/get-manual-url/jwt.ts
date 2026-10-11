// Local verification of a Supabase user access token against the project's
// published signing keys (JWKS), so get-manual-url does not call
// /auth/v1/user on every request.
//
// - Keys come from <SUPABASE_URL>/auth/v1/.well-known/jwks.json, cached per
//   isolate for 10 minutes and refetched once when an unknown kid shows up.
// - ES256 (the project's current key) and RS256 are verified with WebCrypto.
// - Checks: signature, exp (30 s leeway), nbf, aud includes "authenticated",
//   role = "authenticated", sub present. An issuer other than
//   <SUPABASE_URL>/auth/v1 falls back to the network check.
// - Anything we cannot decide locally (HS256 legacy token, JWKS unreachable,
//   unknown kid after a refetch) returns { kind: "fallback" } and the caller
//   uses the network getUser() exactly as before. A token that is decided
//   bad (bad signature, expired, wrong issuer/audience) is rejected.
//
// Only the user id is used downstream. Access itself is still decided per
// request from user_profiles, organization_memberships and the owned lists.

export type Jwk = JsonWebKey & { kid?: string; alg?: string };

export type JwtVerdict =
  | { kind: "ok"; userId: string; claims: Record<string, unknown> }
  | { kind: "reject"; reason: string }
  | { kind: "fallback"; reason: string };

type FetchJwks = (url: string) => Promise<{ keys?: Jwk[] } | null>;

const JWKS_TTL_MS = 10 * 60 * 1000;
const LEEWAY_S = 30;

let cache: { url: string; at: number; keys: Jwk[] } | null = null;

export function resetJwksCacheForTests(): void {
  cache = null;
}

function b64urlBytes(input: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (input.length % 4)) % 4);
  const b64 = (input + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The signing input is base64url text, so plain ASCII. */
function asciiBytes(text: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(text.length));
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

function b64urlJson(input: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(b64urlBytes(input)));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const defaultFetchJwks: FetchJwks = async (url) => {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  return await res.json() as { keys?: Jwk[] };
};

async function jwksKeys(url: string, fetchJwks: FetchJwks, force: boolean, now: number): Promise<Jwk[] | null> {
  if (!force && cache && cache.url === url && now - cache.at < JWKS_TTL_MS) return cache.keys;
  try {
    const body = await fetchJwks(url);
    const keys = Array.isArray(body?.keys) ? body!.keys! : null;
    if (!keys) return cache && cache.url === url ? cache.keys : null;
    cache = { url, at: now, keys };
    return keys;
  } catch {
    return cache && cache.url === url ? cache.keys : null;
  }
}

async function verifySignature(alg: string, jwk: Jwk, data: BufferSource, sig: BufferSource): Promise<boolean> {
  const { kid: _kid, alg: _alg, key_ops: _ops, ext: _ext, use: _use, ...material } = jwk as Record<string, unknown>;
  if (alg === "ES256") {
    const key = await crypto.subtle.importKey(
      "jwk",
      material as JsonWebKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, data);
  }
  if (alg === "RS256") {
    const key = await crypto.subtle.importKey(
      "jwk",
      material as JsonWebKey,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, data);
  }
  return false;
}

export async function verifyAccessTokenLocally(
  token: string,
  supabaseUrl: string,
  opts: { fetchJwks?: FetchJwks; nowMs?: number } = {},
): Promise<JwtVerdict> {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return { kind: "reject", reason: "malformed token" };
  const header = b64urlJson(parts[0]);
  const claims = b64urlJson(parts[1]);
  if (!header || !claims) return { kind: "reject", reason: "malformed token" };

  const alg = String(header.alg || "");
  const kid = header.kid == null ? "" : String(header.kid);
  if (alg !== "ES256" && alg !== "RS256") {
    // HS256 (legacy shared secret) cannot be checked against public keys.
    return { kind: "fallback", reason: `alg ${alg || "none"}` };
  }

  const base = supabaseUrl.replace(/\/$/, "");
  const nowMs = opts.nowMs ?? Date.now();
  const fetchJwks = opts.fetchJwks ?? defaultFetchJwks;
  const url = `${base}/auth/v1/.well-known/jwks.json`;

  let keys = await jwksKeys(url, fetchJwks, false, nowMs);
  let jwk = keys?.find((k) => (kid ? k.kid === kid : true) && (!k.alg || k.alg === alg));
  if (!jwk) {
    keys = await jwksKeys(url, fetchJwks, true, nowMs);
    jwk = keys?.find((k) => (kid ? k.kid === kid : true) && (!k.alg || k.alg === alg));
  }
  if (!keys) return { kind: "fallback", reason: "jwks unavailable" };
  if (!jwk) return { kind: "fallback", reason: "unknown kid" };

  let valid = false;
  try {
    const data = asciiBytes(`${parts[0]}.${parts[1]}`);
    valid = await verifySignature(alg, jwk, data, b64urlBytes(parts[2]));
  } catch {
    valid = false;
  }
  if (!valid) return { kind: "reject", reason: "bad signature" };

  const nowS = Math.floor(nowMs / 1000);
  const exp = Number(claims.exp);
  if (!Number.isFinite(exp) || exp + LEEWAY_S < nowS) return { kind: "reject", reason: "token expired" };
  if (claims.nbf != null && Number(claims.nbf) - LEEWAY_S > nowS) return { kind: "reject", reason: "token not yet valid" };
  // Signed by our key but another issuer (e.g. a custom auth domain): let the network decide.
  if (String(claims.iss || "") !== `${base}/auth/v1`) return { kind: "fallback", reason: "issuer differs" };
  const aud = Array.isArray(claims.aud) ? claims.aud.map(String) : [String(claims.aud || "")];
  if (!aud.includes("authenticated")) return { kind: "reject", reason: "wrong audience" };
  if (String(claims.role || "") !== "authenticated") return { kind: "reject", reason: "not a user token" };
  const sub = String(claims.sub || "").trim();
  if (!sub) return { kind: "reject", reason: "no subject" };

  return { kind: "ok", userId: sub, claims };
}
