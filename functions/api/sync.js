import { json, allowedOrigin, currentUser } from "../_lib/auth.js";

const MAX_BYTES = 2_000_000;
function validPayload(payload) {
  return payload && typeof payload === "object" && !Array.isArray(payload) &&
    Object.keys(payload).length <= 80;
}
export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ error:"La base de datos D1 no está configurada." },503);
  const user = await currentUser(request,env);
  if (!user) return json({ error:"Inicia sesión para sincronizar." },401);
  const row = await env.DB.prepare("SELECT payload,revision,updated_at FROM user_data WHERE user_id=?").bind(user.id).first();
  if (!row) return json({ data:null,revision:0,updatedAt:null });
  let data; try { data=JSON.parse(row.payload); } catch { return json({ error:"Los datos guardados están dañados. No se han modificado." },500); }
  return json({ data,revision:row.revision,updatedAt:row.updated_at });
}
export async function onRequestPut({ request, env }) {
  if (!allowedOrigin(request)) return json({ error:"Origen no permitido." },403);
  if (!env.DB) return json({ error:"La base de datos D1 no está configurada." },503);
  const user = await currentUser(request,env);
  if (!user) return json({ error:"Inicia sesión para sincronizar." },401);
  const length=Number(request.headers.get("Content-Length")||0);
  if(length>MAX_BYTES)return json({error:"Los datos superan el tamaño permitido."},413);
  let body;try{body=await request.json()}catch{return json({error:"Solicitud no válida."},400)}
  if(!validPayload(body.data)||!Number.isInteger(body.revision)||body.revision<0)return json({error:"Formato de sincronización no válido."},400);
  const serialized=JSON.stringify(body.data);
  if(new TextEncoder().encode(serialized).length>MAX_BYTES)return json({error:"Los datos superan el tamaño permitido."},413);
  const existing=await env.DB.prepare("SELECT revision FROM user_data WHERE user_id=?").bind(user.id).first();
  const revision=existing?.revision||0;
  if(revision!==body.revision)return json({error:"CONFLICT",message:"Los datos han cambiado en otro dispositivo. Recarga antes de guardar.",revision},409);
  const next=revision+1;
  await env.DB.prepare("INSERT INTO user_data (user_id,payload,revision,updated_at) VALUES (?,?,?,datetime('now')) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at").bind(user.id,serialized,next).run();
  return json({ok:true,revision:next});
}
