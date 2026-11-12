import { json, allowedOrigin, normalizeEmail, createSession } from "../../_lib/auth.js";

const GOOGLE_CLIENT_ID = "914640448933-dp568ndq78tr5n7ovbchrnn54pon5np7.apps.googleusercontent.com";
const GOOGLE_KEYS_URL = "https://www.googleapis.com/oauth2/v3/certs";

function decodePart(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(normalized), c => c.charCodeAt(0))));
}

async function verifyGoogleCredential(token) {
  if (typeof token !== "string" || token.length > 10000) throw new Error("La respuesta de Google no es válida.");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("La identificación de Google no es válida.");
  const header = decodePart(parts[0]);
  const claims = decodePart(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Firma de Google no válida.");

  const keyResponse = await fetch(GOOGLE_KEYS_URL, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!keyResponse.ok) throw new Error("No se pudieron consultar las claves oficiales de Google.");
  const keySet = await keyResponse.json();
  const jwk = (keySet.keys || []).find(key => key.kid === header.kid && key.kty === "RSA" && key.use === "sig");
  if (!jwk) throw new Error("No se reconoce la clave de firma de Google.");

  const publicKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const signature = Uint8Array.from(atob(parts[2].replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
  const signed = new TextEncoder().encode(parts[0] + "." + parts[1]);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signature, signed);
  if (!valid) throw new Error("No se ha podido verificar la firma de Google.");

  const now = Math.floor(Date.now() / 1000);
  const issuerOk = claims.iss === "accounts.google.com" || claims.iss === "https://accounts.google.com";
  const audienceOk = claims.aud === GOOGLE_CLIENT_ID || (Array.isArray(claims.aud) && claims.aud.includes(GOOGLE_CLIENT_ID));
  if (!issuerOk || !audienceOk || (Array.isArray(claims.aud) && claims.azp !== GOOGLE_CLIENT_ID)) throw new Error("La identificación no corresponde a esta aplicación.");
  if (!Number.isFinite(claims.exp) || claims.exp <= now || !Number.isFinite(claims.iat) || claims.iat > now + 60) throw new Error("La identificación de Google ha caducado o no es válida.");
  if (claims.email_verified !== true && claims.email_verified !== "true") throw new Error("Google no confirma que el correo esté verificado.");
  if (typeof claims.sub !== "string" || !claims.sub || typeof claims.email !== "string") throw new Error("Google no ha devuelto una identidad completa.");
  return { sub: claims.sub, email: normalizeEmail(claims.email) };
}

export async function onRequestPost({ request, env }) {
  if (!allowedOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  if (!env.DB) return json({ error: "La base de datos no está configurada." }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Solicitud no válida." }, 400); }

  try {
    const identity = await verifyGoogleCredential(body.credential);
    const user = await env.DB.prepare("SELECT id,email FROM users WHERE email=?").bind(identity.email).first();
    if (!user) return json({ error: "Esta cuenta de Google no coincide con la cuenta de MI AULA que contiene tus datos. Comprueba que has elegido el correo jmerchanp01@educarex.es." }, 403);
    const session = await createSession(user.id, env);
    return json({ user: { id: user.id, email: user.email } }, 200, { "Set-Cookie": session });
  } catch (error) {
    return json({ error: error?.message || "No se pudo verificar la identidad de Google." }, 401);
  }
}

export async function onRequestGet() {
  return json({ error: "Método no permitido." }, 405);
}
