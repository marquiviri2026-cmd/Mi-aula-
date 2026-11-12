const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
async function equalSecret(a,b){if(!a||!b||a.length!==b.length)return false;const e=new TextEncoder();const [x,y]=await Promise.all([crypto.subtle.digest("SHA-256",e.encode(a)),crypto.subtle.digest("SHA-256",e.encode(b))]);let d=0;for(let i=0;i<x.length;i++)d|=x[i]^y[i];return d===0}
export async function onRequestPost({request,env}){
 const origin=request.headers.get("Origin");if(!origin||origin!==new URL(request.url).origin)return json({error:"Origen no permitido."},403);
 if(!env.OPENAI_API_KEY||!env.MIAULA_ACCESS_TOKEN)return json({error:"Falta configurar la conexión segura en Cloudflare Preview."},503);
 if(!(await equalSecret(request.headers.get("X-MIAULA-TOKEN")||"",env.MIAULA_ACCESS_TOKEN)))return json({error:"Código privado incorrecto."},401);
 let body;try{body=await request.json()}catch{return json({error:"Solicitud no válida."},400)}
 if(!body||typeof body!=="object"||Array.isArray(body))return json({error:"El cuerpo de la solicitud no es válido."},400);
 const {student,group,subject,term}=body;
 const allowed=["Matemáticas","Lengua","Conocimiento del Medio","Educación Física"];
 if(typeof student!=="string"||!student.trim()||student.trim().length>40||!allowed.includes(subject)||!["1.º y 2.º Primaria","4.º Primaria","5.º y 6.º Primaria"].includes(group)||!["1.º trimestre","2.º trimestre","3.º trimestre"].includes(term))return json({error:"Selecciona un código de alumno, curso, materia y trimestre válidos."},400);
 if(!Array.isArray(body.evidence)||body.evidence.length>150)return json({error:"Envía entre 1 y 150 evidencias por análisis. Divide el historial en periodos si supera ese límite."},413);
 const evidence=body.evidence;
 if(!evidence.length)return json({error:"Este alumno todavía no tiene evidencias registradas en esa selección."},400);
 if(evidence.some(e=>!e||typeof e!=="object"||Array.isArray(e)))return json({error:"Una o varias evidencias tienen un formato no válido."},400);
 const invalidScore=evidence.some(e=>e.score!==""&&e.score!=null&&(!Number.isFinite(Number(e.score))||Number(e.score)<0||Number(e.score)>10));
 if(invalidScore)return json({error:"Las notas de las evidencias deben estar entre 0 y 10."},400);
 const clean=evidence.map(e=>({date:String(e.date||"").slice(0,20),kind:String(e.kind||"Evidencia").slice(0,60),score:e.score===""||e.score==null?null:Number(e.score),notes:String(e.notes||"").slice(0,1800),evidence:String(e.evidence||"").slice(0,200)}));
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
 let rawAssessment;try{rawAssessment=JSON.parse(output)}catch{return json({error:"La IA no devolvió una valoración estructurada válida."},502)}
 if(!rawAssessment||typeof rawAssessment!=="object"||Array.isArray(rawAssessment))return json({error:"La IA devolvió una estructura de valoración no válida."},502);
 const validScore=value=>typeof value==="number"&&Number.isFinite(value)&&value>=0&&value<=10?value:null;
 const confidence=value=>["Alta","Media","Baja"].includes(value)?value:"Baja";
 const level=value=>["Inicial","En desarrollo","Adecuado","Avanzado","No evaluable"].includes(value)?value:"No evaluable";
 const validIndices=values=>Array.isArray(values)?[...new Set(values.filter(i=>Number.isInteger(i)&&i>=0&&i<clean.length))]:[];
 const validCompetencies=new Set(criteria.map(c=>c.competency).filter(Boolean));
 const assessment={
  student:student.trim(),subject,period:term,
  overall_score:validScore(rawAssessment.overall_score),
  overall_level:rawAssessment.overall_score==null?"No evaluable":level(rawAssessment.overall_level),
  confidence:confidence(rawAssessment.confidence),
  summary:String(rawAssessment.summary||"").slice(0,3000),
  competencies:(Array.isArray(rawAssessment.competencies)?rawAssessment.competencies:[]).filter(c=>c&&validCompetencies.has(String(c.code))).slice(0,20).map(c=>({code:String(c.code),score:validScore(c.score),level:level(c.level),confidence:confidence(c.confidence),rationale:String(c.rationale||"").slice(0,1200),evidence_indices:validIndices(c.evidence_indices)})),
  criteria:(Array.isArray(rawAssessment.criteria)?rawAssessment.criteria:[]).filter(c=>c&&criteria.some(k=>k.code===String(c.code))).slice(0,100).map(c=>({code:String(c.code),score:validScore(c.score),level:level(c.level),confidence:confidence(c.confidence),rationale:String(c.rationale||"").slice(0,1200),evidence_indices:validIndices(c.evidence_indices)})),
  strengths:(Array.isArray(rawAssessment.strengths)?rawAssessment.strengths:[]).filter(x=>typeof x==="string").slice(0,10).map(x=>x.slice(0,500)),
  needs:(Array.isArray(rawAssessment.needs)?rawAssessment.needs:[]).filter(x=>typeof x==="string").slice(0,10).map(x=>x.slice(0,500)),
  missing_evidence:(Array.isArray(rawAssessment.missing_evidence)?rawAssessment.missing_evidence:[]).filter(x=>typeof x==="string").slice(0,10).map(x=>x.slice(0,500)),
  next_steps:(Array.isArray(rawAssessment.next_steps)?rawAssessment.next_steps:[]).filter(x=>typeof x==="string").slice(0,10).map(x=>x.slice(0,500))
 };
 return json({assessment,criteria_count:criteria.length,evidence_count:clean.length,model:result.model||env.OPENAI_MODEL||"gpt-4.1-mini"});
}
export async function onRequestGet(){return json({error:"Método no permitido."},405)}
