import { json, currentUser } from "../../_lib/auth.js";
const PUSH_WORKER_URL = "https://miaula-push-scheduler.marquiviri2026.workers.dev/public-key";
export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error:"La base de datos D1 no está configurada." },503);
  const user=await currentUser(request,env);
  if(!user)return json({error:"Inicia sesión para activar notificaciones."},401);
  try {
    const response=await fetch(PUSH_WORKER_URL,{headers:{"Accept":"application/json"}});
    const result=await response.json();
    if(!response.ok||!result.publicKey)throw new Error(result.error||"El servicio Push no está disponible.");
    return json({publicKey:result.publicKey});
  } catch(error) {
    return json({error:error?.message||"No se pudo consultar el servicio Push."},503);
  }
}