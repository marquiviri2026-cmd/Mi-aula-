const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
async function equalSecret(a,b){if(!a||!b||a.length!==b.length)return false;const e=new TextEncoder();const [x,y]=await Promise.all([crypto.subtle.digest("SHA-256",e.encode(a)),crypto.subtle.digest("SHA-256",e.encode(b))]);let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0}
export async function onRequestPost({request,env}){
 const origin=request.headers.get("Origin");if(!origin||origin!==new URL(request.url).origin)return json({error:"Origen no permitido."},403);
 if(!env.OPENAI_API_KEY||!env.MIAULA_ACCESS_TOKEN)return json({error:"Falta configurar la conexión segura en Cloudflare Preview."},503);
 if(!(await equalSecret(request.headers.get("X-MIAULA-TOKEN")||"",env.MIAULA_ACCESS_TOKEN)))return json({error:"Código privado incorrecto."},401);
 let body;try{body=await request.json()}catch{return json({error:"Solicitud no válida."},400)}
 const {student,group,subject,term}=body;
 const allowed=["Matemáticas","Lengua","Conocimiento del Medio","Educación Física"];
 if(typeof student!=="string"||!student.trim()||student.length>40||!allowed.includes(subject)||typeof group!=="string"||!term)return json({error:"Faltan datos de alumno, grupo, materia o periodo."},400);
 const evidence=Array.isArray(body.evidence)?body.evidence.slice(0,150):[];
 if(!evidence.length)return json({error:"Este alumno todavía no tiene evidencias registradas en esa selección."},400);
 const clean=evidence.map((e,i)=>({date:String(e.date||"").slice(0,20),kind:String(e.kind||"Evidencia").slice(0,60),score:e.score===""||e.score==null?null:Math.max(0,Math.min(10,Number(e.score))),notes:String(e.notes||"").slice(0,1800),evidence:String(e.evidence||"").slice(0,200)}));
 if(clean.some(e=>e.score!==null&&!Number.isFinite(e.score)))return json({error:"Hay una nota numérica no válida."},400);
 let catalog;try{const r=await fetch(new URL("/criterios-extremadura.json",request.url));if(!r.ok)throw Error();catalog=await r.json()}catch{return json({error:"No se ha podido cargar el catálogo curricular oficial."},503)}
 const cycle=group.includes("1.º y 2.º")?"Primer ciclo":group.includes("4.º")?"Segundo ciclo":"Tercer ciclo";
 const criteria=(catalog.criteria||[]).filter(c=>c.subject===subject&&c.grade===cycle).map(c=>({code:c.code,description:c.description,competency:c.competency}));
 if(!criteria.length)return json({error:"No hay criterios oficiales para esta materia y ciclo."},422);
 const prompt=`Realiza una valoración competencial acumulativa de un alumno de Educación Primaria en Extremadura. No pidas al docente que vincule evidencias: debes inferir tú las relaciones curriculares a partir de los datos.
CONTEXTO: Alumno ${student}; grupo ${group}; ciclo ${cycle}; materia ${subject}; periodo ${term}.
EVIDENCIAS RECOGIDAS (pueden incluir notas de exámenes y observaciones):
${JSON.stringify(clean)}
CATÁLOGO OFICIAL DE CRITERIOS DEL ÁREA Y CICLO (única referencia válida para códigos y redacción):
${JSON.stringify(criteria)}
INSTRUCCIONES:
- Relaciona cada evidencia con uno o varios criterios solo si hay correspondencia demostrable. No fuerces relaciones.
- Integra el conjunto de evidencias, no valores una competencia por una sola nota salvo que la evidencia mida directamente ese desempeño y explica el alcance.
- Distingue nota de examen, desempeño observado, proceso y conducta. No conviertas asistencia, obediencia, esfuerzo o comportamiento en calificación de aprendizaje.
- Los resultados numéricos de exámenes son evidencia relevante, pero no equivalen automáticamente a la nota competencial; contextualízalos con las observaciones.
- Valora criterios y competencias específicas (CE1, CE2...) con nota orientativa 0-10 cuando haya base suficiente; si no, usa null y explica qué falta.
- No inventes evidencias, niveles, criterios ni pesos oficiales. Los criterios del catálogo no tienen ponderación oficial en esta petición.
- Calcula una nota competencial global orientativa solo si hay cobertura suficiente y evidencia variada; de lo contrario devuelve null.
- Incluye confianza (alta/media/baja), evidencias que sustentan cada valoración, lagunas y recomendaciones concretas.
- El resultado es una propuesta de apoyo docente, no una calificación oficial automática.
Devuelve exclusivamente JSON válido con esta estructura:
{"student":"...","subject":"...","period":"...","overall_score":number|null,"overall_level":"Inicial|En desarrollo|Adecuado|Avanzado|No evaluable","confidence":"Alta|Media|Baja","summary":"...","competencies":[{"code":"CE1","score":number|null,"level":"...","confidence":"...","rationale":"...","evidence_indices":[0]}],"criteria":[{"code":"...","score":number|null,"level":"...","confidence":"...","evidence_indices":[0],"rationale":"..."}],"strengths":["..."],"needs":["..."],"missing_evidence":["..."],"next_steps":["..."]}. evidence_indices son posiciones de la lista de evidencias empezando por cero.`;
 const payload={model:env.OPENAI_MODEL||"gpt-4.1-mini",instructions:"Eres especialista en evaluación competencial de Educación Primaria. Sé riguroso, prudente y transparente. Responde únicamente con JSON válido, sin Markdown ni texto adicional.",input:[{role:"user",content:[{type:"input_text",text:prompt}]}],text:{format:{type:"json_object"}},max_output_tokens:5000,store:false};
 let response;try{response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:"Bearer "+env.OPENAI_API_KEY,"Content-Type":"application/json"},body:JSON.stringify(payload)})}catch{return json({error:"No se pudo conectar con OpenAI."},502)}
 const result=await response.json();if(!response.ok)return json({error:result.error?.message||"Error al evaluar."},502);
 const output=(result.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==="output_text").map(x=>x.text||"").join("");
 let assessment;try{assessment=JSON.parse(output)}catch{return json({error:"La IA no devolvió una valoración estructurada válida."},502)}
 return json({assessment,criteria_count:criteria.length,evidence_count:clean.length,model:result.model||env.OPENAI_MODEL||"gpt-4.1-mini"});
}
export async function onRequestGet(){return json({error:"Método no permitido."},405)}
