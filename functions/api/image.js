const MAX_PROMPT = 4000;
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}})}
async function equalSecret(a,b){
 if(!a||!b||a.length!==b.length)return false;
 const enc=new TextEncoder(),[ha,hb]=await Promise.all([crypto.subtle.digest("SHA-256",enc.encode(a)),crypto.subtle.digest("SHA-256",enc.encode(b))]);
 const x=new Uint8Array(ha),y=new Uint8Array(hb);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;
}
export async function onRequestPost({request,env}){
 const origin=request.headers.get("Origin"),requestOrigin=new URL(request.url).origin;
 if(!origin||origin!==requestOrigin)return json({error:"Origen no permitido."},403);
 if(!env.OPENAI_API_KEY)return json({error:"Falta configurar OPENAI_API_KEY en Cloudflare Production."},503);
 if(!env.MIAULA_ACCESS_TOKEN)return json({error:"Falta configurar MIAULA_ACCESS_TOKEN en Cloudflare Production."},503);
 const supplied=request.headers.get("X-MIAULA-TOKEN")||"";
 if(!supplied)return json({error:"La aplicación no ha enviado el código privado."},400);
 if(!(await equalSecret(supplied,env.MIAULA_ACCESS_TOKEN)))return json({error:"El código privado no coincide."},401);
 let body;try{body=await request.json()}catch{return json({error:"Petición no válida."},400)}
 const prompt=typeof body.prompt==="string"?body.prompt.trim():"";
 if(!prompt)return json({error:"Describe la imagen que quieres generar."},400);
 if(prompt.length>MAX_PROMPT)return json({error:"La descripción es demasiado larga (máximo 4.000 caracteres)."},413);
 let upstream;try{
  upstream=await fetch("https://api.openai.com/v1/images/generations",{method:"POST",headers:{Authorization:"Bearer "+env.OPENAI_API_KEY,"Content-Type":"application/json"},body:JSON.stringify({model:env.OPENAI_IMAGE_MODEL||"gpt-image-2.6-flare",prompt,size:"1024x1024",quality:"medium",output_format:"png",n:1})});
 }catch{return json({error:"No se pudo conectar con el servicio de imágenes."},502)}
 const raw=await upstream.text();let result;try{result=JSON.parse(raw)}catch{result={}};
 if(!upstream.ok)return json({error:(result?.error?.message||"OpenAI no ha podido generar la imagen.").slice(0,500)},upstream.status===429?429:502);
 const image=result.data?.[0]?.b64_json;
 if(!image)return json({error:"El servicio no ha devuelto una imagen descargable."},502);
 return json({image,format:"png",model:result.model||env.OPENAI_IMAGE_MODEL||"gpt-image-2.6-flare"});
}
export async function onRequestGet(){return json({error:"Método no permitido."},405)}
