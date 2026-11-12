import { json, allowedOrigin, normalizeEmail, validEmail, verifyPassword, createSession } from "../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!allowedOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  if (!env.DB) return json({ error: "La base de datos D1 no está configurada." }, 503);
  let body; try { body = await request.json(); } catch { return json({ error: "Solicitud no válida." }, 400); }
  const email = normalizeEmail(body.email), password = body.password;
  if (!validEmail(email) || typeof password !== "string" || password.length > 128) return json({ error: "Correo o contraseña incorrectos." }, 401);
  const key = "login:" + email + ":" + (request.headers.get("CF-Connecting-IP") || "unknown");
  const now = new Date();
  const attempt = await env.DB.prepare("SELECT attempts,window_started_at,blocked_until FROM auth_attempts WHERE attempt_key=?").bind(key).first();
  if (attempt?.blocked_until && new Date(attempt.blocked_until) > now) return json({ error: "Demasiados intentos. Espera unos minutos." }, 429);
  if (attempt?.window_started_at && now - new Date(attempt.window_started_at) > 15 * 60 * 1000) await env.DB.prepare("DELETE FROM auth_attempts WHERE attempt_key=?").bind(key).run();
  const user = await env.DB.prepare("SELECT id,email,password_hash,password_salt,password_iterations FROM users WHERE email=?").bind(email).first();
  const ok = user && await verifyPassword(password,user.password_hash,user.password_salt,user.password_iterations);
  if (!ok) {
    const count = (attempt?.window_started_at && now - new Date(attempt.window_started_at) <= 15 * 60 * 1000 ? attempt.attempts : 0) + 1;
    const blocked = count >= 8 ? new Date(now.getTime() + 15 * 60 * 1000).toISOString() : null;
    await env.DB.prepare("INSERT INTO auth_attempts (attempt_key,attempts,window_started_at,blocked_until) VALUES (?,?,?,?) ON CONFLICT(attempt_key) DO UPDATE SET attempts=excluded.attempts,window_started_at=excluded.window_started_at,blocked_until=excluded.blocked_until").bind(key,count,attempt?.window_started_at || now.toISOString(),blocked).run();
    return json({ error: "Correo o contraseña incorrectos." }, 401);
  }
  await env.DB.prepare("DELETE FROM auth_attempts WHERE attempt_key=?").bind(key).run();
  const session = await createSession(user.id, env);
  return json({ user: { id:user.id,email:user.email } }, 200, { "Set-Cookie": session });
}
export async function onRequestGet() { return json({ error: "Método no permitido." }, 405); }
