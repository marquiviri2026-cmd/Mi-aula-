import { json, allowedOrigin, currentUser } from "../../_lib/auth.js";
const validB64 = value => typeof value === "string" && /^[A-Za-z0-9_-]{20,200}$/.test(value);
export async function onRequestPost({ request, env }) {
  if(!allowedOrigin(request))return json({error:"Origen no permitido."},403);
  if(!env.DB)return json({error:"La base de datos D1 no está configurada."},503);
  const user=await currentUser(request,env);if(!user)return json({error:"Inicia sesión."},401);
  let body;try{body=await request.json()}catch{return json({error:"Solicitud no válida."},400)}
  const sub=body?.subscription,endpoint=sub?.endpoint,keys=sub?.keys;
  if(typeof endpoint!=="string"||endpoint.length>2048||!endpoint.startsWith("https://")||!validB64(keys?.p256dh)||!validB64(keys?.auth))return json({error:"La suscripción Push no tiene un formato válido."},400);
  const id=crypto.randomUUID();
  await env.DB.prepare("INSERT INTO push_subscriptions (id,user_id,endpoint,p256dh,auth) VALUES (?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,p256dh=excluded.p256dh,auth=excluded.auth").bind(id,user.id,endpoint,keys.p256dh,keys.auth).run();
  return json({ok:true});
}
export async function onRequestDelete({ request, env }) {
  if(!allowedOrigin(request))return json({error:"Origen no permitido."},403);
  if(!env.DB)return json({error:"La base de datos D1 no está configurada."},503);
  const user=await currentUser(request,env);if(!user)return json({error:"Inicia sesión."},401);
  let body;try{body=await request.json()}catch{return json({error:"Solicitud no válida."},400)}
  if(typeof body?.endpoint!=="string")return json({error:"Falta el endpoint."},400);
  await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?").bind(body.endpoint,user.id).run();
  return json({ok:true});
}