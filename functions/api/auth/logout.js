import { json, allowedOrigin, clearSession } from "../../_lib/auth.js";
export async function onRequestPost({ request, env }) {
  if (!allowedOrigin(request)) return json({ error: "Origen no permitido." }, 403);
  if (!env.DB) return json({ error: "La base de datos D1 no está configurada." }, 503);
  const cookie = await clearSession(request, env);
  return json({ ok:true },200,{"Set-Cookie":cookie});
}
