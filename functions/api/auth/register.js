import { json, allowedOrigin, normalizeEmail, validEmail, hashPassword, createSession, passwordPolicy } from "../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!allowedOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  if (!env.DB) return json({ error: "La base de datos D1 no está configurada." }, 503);
  if (!env.MIAULA_SETUP_KEY) return json({ error: "El registro inicial aún no está habilitado por el administrador." }, 503);
  let body; try { body = await request.json(); } catch { return json({ error: "Solicitud no válida." }, 400); }
  const email = normalizeEmail(body.email), password = body.password, setupKey = body.setupKey;
  if (!validEmail(email) || !passwordPolicy(password) || typeof setupKey !== "string") return json({ error: "Comprueba el correo, la contraseña (mínimo 12 caracteres) y el código de configuración." }, 400);
  if (setupKey !== env.MIAULA_SETUP_KEY) return json({ error: "Código de configuración incorrecto." }, 403);
  if (email !== "jmerchanp01@educarex.es") return json({ error: "Este correo no está autorizado para la cuenta inicial." }, 403);
  const exists = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
  if (exists) return json({ error: "La cuenta ya existe. Inicia sesión." }, 409);
  const { hash, salt, iterations } = await hashPassword(password);
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO users (id,email,password_hash,password_salt,password_iterations) VALUES (?,?,?,?,?)").bind(id,email,hash,salt,iterations).run();
  const session = await createSession(id, env);
  return json({ user: { id, email } }, 201, { "Set-Cookie": session });
}
export async function onRequestGet() { return json({ error: "Método no permitido." }, 405); }
