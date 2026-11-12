import { json, allowedOrigin, currentUser, hashPassword, passwordPolicy } from "../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!allowedOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  if (!env.DB) return json({ error: "La base de datos D1 no está configurada." }, 503);
  const user = await currentUser(request, env);
  if (!user) return json({ error: "La sesión ha caducado. Inicia sesión de nuevo." }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Solicitud no válida." }, 400); }
  const password = body?.password;
  if (!passwordPolicy(password)) return json({ error: "La contraseña debe tener entre 12 y 128 caracteres." }, 400);
  try {
    const { hash, salt, iterations } = await hashPassword(password);
    await env.DB.prepare("UPDATE users SET password_hash=?, password_salt=?, password_iterations=? WHERE id=?")
      .bind(hash, salt, iterations, user.id).run();
    await env.DB.prepare("DELETE FROM auth_attempts WHERE attempt_key LIKE ?")
      .bind("login:" + user.email + ":%").run();
    return json({ message: "Contraseña actualizada correctamente." });
  } catch (error) {
    console.error("MI_AULA_PASSWORD_CHANGE_ERROR", error?.name || "Error", error?.message || "unknown");
    return json({ error: "No se pudo actualizar la contraseña. Inténtalo de nuevo." }, 500);
  }
}

export async function onRequestGet() { return json({ error: "Método no permitido." }, 405); }
