const COOKIE = "__Host-miaula_session";
const SESSION_DAYS = 30;
// Cloudflare Workers Web Crypto rejects PBKDF2 iteration counts above 100,000.
const ITERATIONS = 100000;

export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers }
});

export function allowedOrigin(request) {
  const origin = request.headers.get("Origin");
  return !!origin && origin === new URL(request.url).origin;
}

export function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function b64(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(value) {
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}
export async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16)), iterations = ITERATIONS) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, 256);
  return { hash: b64(bits), salt: b64(salt), iterations };
}
export async function verifyPassword(password, storedHash, storedSalt, iterations) {
  const computed = await hashPassword(password, fromB64(storedSalt), iterations);
  const a = fromB64(computed.hash), b = fromB64(storedHash);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function digest(value) {
  return b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
function cookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export async function createSession(userId, env) {
  const token = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (id_hash,user_id,expires_at) VALUES (?,?,?)").bind(await digest(token), userId, expires).run();
  return cookie(token, SESSION_DAYS * 86400);
}
export async function clearSession(request, env) {
  const token = getCookie(request, COOKIE);
  if (token && env.DB) await env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await digest(token)).run();
  return cookie("", 0);
}
function getCookie(request, name) {
  const raw = request.headers.get("Cookie") || "";
  const part = raw.split(";").map(x => x.trim()).find(x => x.startsWith(name + "="));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : "";
}
export async function currentUser(request, env) {
  const token = getCookie(request, COOKIE);
  if (!token) return null;
  const row = await env.DB.prepare(
    "SELECT u.id,u.email,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=? AND s.expires_at>?"
  ).bind(await digest(token), new Date().toISOString()).first();
  return row || null;
}
export const passwordPolicy = password => typeof password === "string" && password.length >= 12 && password.length <= 128;
export const PASSWORD_ITERATIONS = ITERATIONS;
