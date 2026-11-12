import { json, currentUser } from "../../_lib/auth.js";
export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error: "La base de datos D1 no está configurada." }, 503);
  const user = await currentUser(request, env);
  if (!user) return json({ user:null }, 200);
  return json({ user:{ id:user.id,email:user.email } });
}
