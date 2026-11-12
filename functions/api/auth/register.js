import { json, allowedOrigin, normalizeEmail, validEmail, hashPassword, createSession, passwordPolicy } from "../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  let stage = "origin";
  try {
    if (!allowedOrigin(request)) return json({ error: "Origen no permitido." }, 403);
    stage = "database_binding";
    if (!env.DB) return json({ error: "La base de datos D1 no está configurada." }, 503);
    stage = "setup_key";
    if (!env.MIAULA_SETUP_KEY) return json({ error: "El registro inicial aún no está habilitado por el administrador." }, 503);
    stage = "request_body";
    let body; try { body = await request.json(); } catch { return json({ error: "Solicitud no válida." }, 400); }
    const email = normalizeEmail(body.email), password = body.password, setupKey = body.setupKey;
    if (!validEmail(email) || !passwordPolicy(password) || typeof setupKey !== "string") return json({ error: "Comprueba el correo, la contraseña (mínimo 12 caracteres) y el código de configuración." }, 400);
    stage = "setup_key_check";
    if (setupKey !== env.MIAULA_SETUP_KEY) return json({ error: "Código de configuración incorrecto." }, 403);
    if (email !== "jmerchanp01@educarex.es") return json({ error: "Este correo no está autorizado para la cuenta inicial." }, 403);
    stage = "database_lookup";
    const exists = await env.DB.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
    if (exists) return json({ error: "La cuenta ya existe. Inicia sesión." }, 409);
    stage = "password_hash";
    const { hash, salt, iterations } = await hashPassword(password);
    const id = crypto.randomUUID();
    stage = "user_insert";
    await env.DB.prepare("INSERT INTO users (id,email,password_hash,password_salt,password_iterations) VALUES (?,?,?,?,?)").bind(id,email,hash,salt,iterations).run();
    stage = "session_create";
    const session = await createSession(id, env);
    return json({ user: { id, email } }, 201, { "Set-Cookie": session });
  } catch (error) {
    console.error("MI_AULA_REGISTER_ERROR", stage, error?.name || "Error", error?.message || "unknown");
    return json({ error: "Fallo interno durante el registro.", stage }, 500);
  }
}
export async function onRequestGet() { return json({ error: "Método no permitido." }, 405); }
