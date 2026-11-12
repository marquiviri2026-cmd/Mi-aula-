const MAX_FILE=18*1024*1024;
async function equalSecret(a,b){if(!a||!b||a.length!==b.length)return false;const e=new TextEncoder();const [x,y]=await Promise.all([crypto.subtle.digest("SHA-256",e.encode(a)),crypto.subtle.digest("SHA-256",e.encode(b))]);let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0}
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
export async function onRequestPost({request,env}){
 const origin=request.headers.get("Origin");if(!origin||origin!==new URL(request.url).origin)return json({error:"Origen no permitido."},403);
 if(!env.OPENAI_API_KEY||!env.MIAULA_ACCESS_TOKEN)return json({error:"Falta configurar la conexión segura en Cloudflare Preview."},503);
 if(!(await equalSecret(request.headers.get("X-MIAULA-TOKEN")||"",env.MIAULA_ACCESS_TOKEN)))return json({error:"Código privado incorrecto."},401);
 let form;try{form=await request.formData()}catch{return json({error:"Formulario o archivos no válidos."},400)}
 const files=form.getAll("files").filter(x=>x instanceof File);
 if(!files.length)return json({error:"Adjunta al menos un archivo."},400);
 if(files.length>5||files.some(f=>f.size>MAX_FILE))return json({error:"Máximo 5 archivos y 18 MiB por archivo."},413);
 const group=String(form.get("group")||"").slice(0,80),subject=String(form.get("subject")||"").slice(0,80),term=String(form.get("term")||"").slice(0,40),student=String(form.get("student")||"").slice(0,40);
 if(!group||!subject||!student)return json({error:"Indica grupo, materia y código anónimo del alumno."},400);
 const uploaded=[];
 try{
  for(const file of files){
   const fd=new FormData();fd.append("purpose","user_data");fd.append("file",file,file.name);
   const up=await fetch("https://api.openai.com/v1/files",{method:"POST",headers:{Authorization:"Bearer "+env.OPENAI_API_KEY},body:fd});
   const uj=await up.json();if(!up.ok)throw Error(uj.error?.message||"No se pudo procesar "+file.name);uploaded.push({id:uj.id,name:file.name});
  }
  const prompt="Eres un asistente técnico de evaluación formativa en Educación Primaria de Extremadura. Analiza exclusivamente lo que realmente se observa en los archivos adjuntos. Contexto: ciclo/grupo "+group+"; área "+subject+"; periodo "+term+". Código anónimo del alumno: "+student+".\n\nREGLAS OBLIGATORIAS: No inventes respuestas que no sean legibles, criterios curriculares, códigos, evidencias ni niveles. El Decreto 107/2022 establece criterios por ciclo y área; si no tienes el texto oficial exacto disponible, indica que el criterio necesita contraste con el currículo oficial y no fabriques su redacción. Distingue rendimiento de la evidencia de conducta, esfuerzo, asistencia o presentación. No deduzcas necesidades educativas ni diagnósticos. Si un archivo contiene datos identificativos de menores, no los reproduzcas. No asignes calificación numérica global por una única evidencia ni transformes automáticamente el resultado del control en nota trimestral. Devuelve: (1) resumen verificable de cada archivo; (2) aprendizajes observables; (3) posibles criterios relacionados con código y redacción solo cuando puedas sostenerlos; (4) nivel orientativo con justificación; (5) qué no puede valorarse; (6) propuesta de registro sin calificación o con valoración parcial justificada; (7) evidencias complementarias recomendadas. Termina con una lista JSON válida en bloque \u0060\u0060\u0060json con campos criterion_code, criterion_text, confidence, evidence_summary, suggested_level, suggested_score (null si no hay base), rationale. Todo requiere validación docente.";
  const body={model:env.OPENAI_MODEL||"gpt-4.1-mini",instructions:"Responde en español. Sé prudente, objetivo y transparente. No presentes inferencias como hechos. No des por oficial ningún criterio que no puedas verificar.",input:[{role:"user",content:[{type:"input_text",text:prompt},...uploaded.map(x=>({type:"input_file",file_id:x.id}))]}],max_output_tokens:3000,store:false};
  if(env.OPENAI_VECTOR_STORE_ID){body.tools=[{type:"file_search",vector_store_ids:[env.OPENAI_VECTOR_STORE_ID],max_num_results:8}];body.include=["file_search_call.results"]}
  const rr=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:"Bearer "+env.OPENAI_API_KEY,"Content-Type":"application/json"},body:JSON.stringify(body)});
  const out=await rr.json();if(!rr.ok)throw Error(out.error?.message||"Error al analizar la evidencia.");
  const answer=(out.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==="output_text").map(x=>x.text||"").join("\n").trim();
  if(!answer)throw Error("La IA no ha devuelto un análisis.");
  return json({answer,files:uploaded.map(x=>x.name),requires_teacher_review:true,library_connected:!!env.OPENAI_VECTOR_STORE_ID});
 }catch(e){return json({error:String(e.message||e).slice(0,500)},502)}
}
export async function onRequestGet(){return json({error:"Método no permitido."},405)}
