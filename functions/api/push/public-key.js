import { json, currentUser } from "../../_lib/auth.js";
const VAPID_PUBLIC_KEY = "BGhnC17c2n1juVj8VrTBIa6Pcdtms6XLPxPgF3Z82DIi4ZQrbe4bbQJjZ-TYN1QsoWNES8oIXgPbEKGYtWqtDkI";
export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error:"La base de datos D1 no está configurada." },503);
  const user=await currentUser(request,env);
  if(!user)return json({error:"Inicia sesión para activar notificaciones."},401);
  return json({publicKey:VAPID_PUBLIC_KEY});
}