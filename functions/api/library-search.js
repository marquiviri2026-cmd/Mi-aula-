import { findLibraryStore } from "../lib/vector-store.js";
const MAX_QUERY = 1000;
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}})}
async function equalSecret(a,b){if(!a||!b||a.length!==b.length)return false;const e=new TextEncoder();const [x,y]=await Promise.all([crypto.subtle.digest("SHA-256",e.encode(a)),crypto.subtle.digest("SHA-256",e.encode(b))]);const A=new Uint8Array(x),B=new Uint8Array(y);let d=0;for(let i=0;i<A.length;i++)d|=A[i]^B[i];return d===0}
async function openai(env,path,options={}){return fetch("https://api.openai.com/v1"+path,{...options,headers:{Authorization:"Bearer "+env.OPENAI_API_KEY,...(options.headers||{})}})}
export async function onRequestPost({request,env}){
  const origin=request.headers.get("Origin"),requestOrigin=new URL(request.url).origin;
  if(!origin||origin!==requestOrigin)return json({error:"Origen no permitido."},403);
  if(!env.MIAULA_ACCESS_TOKEN)return json({error:"Falta MIAULA_ACCESS_TOKEN en Preview."},503);
  const supplied=request.headers.get("X-MIAULA-TOKEN")||"";
  if(!supplied)return json({error:"Introduce el código privado."},400);
  if(!(await equalSecret(supplied,env.MIAULA_ACCESS_TOKEN)))return json({error:"El código privado no coincide."},401);
  if(!env.OPENAI_API_KEY)return json({error:"Falta OPENAI_API_KEY."},503);
  let store;try{store=await findLibraryStore(env)}catch(e){return json({error:e.message},502)}if(!store)return json({error:"No se ha encontrado una biblioteca MI AULA."},503);
  let body;try{body=await request.json()}catch{return json({error:"Petición no válida."},400)}
  const query=typeof body.query==="string"?body.query.trim():"";
  if(!query)return json({error:"Escribe qué quieres buscar."},400);
  if(query.length>MAX_QUERY)return json({error:"La búsqueda supera los 1.000 caracteres."},413);
  let upstream;try{upstream=await openai(env,"/vector_stores/"+encodeURIComponent(store.id)+"/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({query,max_num_results:8})})}catch{return json({error:"No se pudo conectar con la biblioteca."},502)}
  const raw=await upstream.text();let result;try{result=JSON.parse(raw)}catch{result={}};
  if(!upstream.ok)return json({error:(result.error?.message||"OpenAI no pudo completar la búsqueda.").slice(0,400)},502);
  const data=Array.isArray(result.data)?result.data:[];
  const names=new Map();
  const ids=[...new Set(data.map(x=>x.file_id).filter(Boolean))];
  await Promise.all(ids.map(async id=>{try{const r=await openai(env,"/files/"+encodeURIComponent(id));const j=await r.json();if(r.ok)names.set(id,j.filename||id)}catch{}}));
  const results=data.map(hit=>({file_id:hit.file_id,filename:hit.filename||names.get(hit.file_id)||"Documento",subject:hit.attributes?.subject||"",grade:hit.attributes?.grade||"",score:hit.score??null,text:(hit.content||[]).filter(c=>c.type==="text").map(c=>c.text||"").join("\n").slice(0,5000)}));
  const docs=new Set(results.map(x=>x.file_id).filter(Boolean));
  return json({results,documents_found:docs.size});
}
export async function onRequestGet(){return json({error:"Método no permitido."},405)}
