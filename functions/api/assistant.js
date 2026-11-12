const MAX_BODY = 24000;
const MAX_PROMPT = 12000;
const MAX_HISTORY = 8;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  }});
}
async function equalSecret(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b))
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0; for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin"), requestOrigin = new URL(request.url).origin;
  if (!origin || origin !== requestOrigin) return json({ error: "Origen no permitido." }, 403);
  const runtimeBindingNames = Object.keys(env || {}).sort();
  if (!env.OPENAI_API_KEY) return json({
    code: "OPENAI_API_KEY_MISSING",
    error: "Falta configurar OPENAI_API_KEY en Cloudflare. Diagnóstico temporal: OPENAI_API_KEY=" + (env.OPENAI_API_KEY ? "SI" : "NO") + "; MIAULA_ACCESS_TOKEN=" + (env.MIAULA_ACCESS_TOKEN ? "SI" : "NO") + "; OPENAI_VECTOR_STORE_ID=" + (env.OPENAI_VECTOR_STORE_ID ? "SI" : "NO") + "; host=" + new URL(request.url).hostname + "; bindings=" + runtimeBindingNames.join(","),
    diagnostic: {
      openaiApiKeyPresent: Boolean(env.OPENAI_API_KEY),
      accessTokenPresent: Boolean(env.MIAULA_ACCESS_TOKEN),
      vectorStoreIdPresent: Boolean(env.OPENAI_VECTOR_STORE_ID),
      runtime: "pages-function",
      hostname: new URL(request.url).hostname,
      availableBindingNames: runtimeBindingNames
    }
  }, 503);
  if (!env.MIAULA_ACCESS_TOKEN) return json({ code:"SERVER_TOKEN_MISSING", error:"Falta MIAULA_ACCESS_TOKEN en el entorno Preview de Cloudflare." }, 503);
  const suppliedToken = request.headers.get("X-MIAULA-TOKEN") || "";
  if (!suppliedToken) return json({ code:"CLIENT_TOKEN_MISSING", error:"La aplicación no ha enviado el código privado." }, 400);
  if (!(await equalSecret(suppliedToken, env.MIAULA_ACCESS_TOKEN)))
    return json({ code:"TOKEN_MISMATCH", error:"El código enviado no coincide con el configurado en este entorno." }, 401);
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_BODY) return json({ error: "La petición supera el tamaño permitido." }, 413);
  let body; try { body = await request.json(); } catch { return json({ error: "JSON no válido." }, 400); }
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return json({ error: "Escribe una consulta." }, 400);
  if (prompt.length > MAX_PROMPT) return json({ error: "Consulta demasiado larga (máximo 12.000 caracteres)." }, 413);
  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : [];
  const safeHistory = history.filter(m => m && ["user","assistant"].includes(m.role) && typeof m.content === "string")
    .map(m => ({
      role:m.role,
      content:[{type:m.role === "assistant" ? "output_text" : "input_text",text:m.content.slice(0,4000)}]
    }));
  const instructions = [
    "Eres el asistente pedagógico de MI AULA, una aplicación privada de apoyo docente.",
    "Responde en español claro, preciso y práctico. Adapta propuestas a Educación Primaria y aulas multinivel cuando corresponda.",
    "Cuando haya documentos en la biblioteca, utiliza file_search para fundamentar la respuesta. Prioriza siempre esos documentos sobre tu conocimiento general.",
    "Distingue claramente la información encontrada en los libros de tus propuestas o conocimientos generales. No inventes citas, páginas, autores, normativa ni resultados.",
    "Cuando uses la biblioteca, identifica el nombre del documento y la página o apartado solo si la fuente proporciona esa referencia. Si no aparece, dilo expresamente.",
    "Si los documentos no contienen la respuesta, indica que no has encontrado esa información; no rellenes huecos como si procedieran del libro.",
    "No solicites nombres, apellidos, direcciones, diagnósticos ni otros datos identificativos de menores. Recomienda códigos anónimos.",
    "Responde usando Markdown legible: títulos, subtítulos, **negritas**, listas numeradas o con viñetas, tablas cuando ayuden y bloques de código solo cuando proceda. Evita respuestas como un bloque plano de texto.",
    "Para pruebas, fichas, rúbricas y materiales, entrega el contenido completo, bien maquetado y listo para imprimir. Si se solicita solucionario, sepáralo del material del alumnado.",
    "MI AULA permite descargar las respuestas como PDF, HTML o Markdown mediante los botones bajo cada respuesta. No afirmes que has creado archivos adjuntos de otros formatos si no se han generado realmente. Cuando el usuario solicite un PDF, estructura el contenido con títulos claros, tablas sencillas y formato listo para imprimir.",
    "MI AULA también dispone de generación real de imágenes mediante el botón «Generar imagen» y de la acción «Crear imagen de esta respuesta» que aparece debajo de tus mensajes. Si el usuario pide una imagen, infografía, cartel, ilustración, ficha visual o diseño gráfico, NO digas que no puedes crear imágenes ni te limites a ofrecer instrucciones para Canva o PowerPoint. Diseña la propuesta visual y entrega una descripción/prompt listo para generar; indica brevemente que pulse «Crear imagen de esta respuesta» debajo de tu respuesta. Si el usuario ya está usando esa acción, el sistema enviará tu contenido al generador de imágenes. No afirmes que la imagen ya está creada hasta que aparezca la imagen generada.",
    "Cuando el usuario pida un material imprimible o un documento, crea el contenido completo y recuérdale que puede pulsar «Descargar PDF» debajo de tu respuesta. No confundas generar el contenido con haber descargado el archivo."
  ].join("\n");
  const payload = {
    model: env.OPENAI_MODEL || "gpt-4.1-mini",
    instructions,
    input: [...safeHistory, {role:"user",content:[{type:"input_text",text:prompt}]}],
    max_output_tokens: 2600,
    store: false
  };
  if (env.OPENAI_VECTOR_STORE_ID) {
    payload.tools = [{ type:"file_search", vector_store_ids:[env.OPENAI_VECTOR_STORE_ID], max_num_results:6 }];
    payload.include = ["file_search_call.results"];
  }
  let upstream;
  try {
    upstream = await fetch("https://api.openai.com/v1/responses", {
      method:"POST", headers:{Authorization:"Bearer "+env.OPENAI_API_KEY,"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    });
  } catch { return json({error:"No se pudo conectar con OpenAI."},502); }
  const raw=await upstream.text(); let result; try{result=JSON.parse(raw)}catch{result={}};
  if(!upstream.ok) return json({error:(result?.error?.message||"OpenAI ha rechazado la petición.").slice(0,400)},upstream.status===429?429:502);
  const parts=(result.output||[]).flatMap(item=>item.content||[]);
  const answer=parts.filter(p=>p.type==="output_text").map(p=>p.text||"").join("\n").trim();
  const sources=[];
  for (const item of result.output||[]) {
    if(item.type==="file_search_call") for(const hit of item.results||[]) {
      const name=hit.filename||hit.file_id||"Documento";
      if(!sources.some(s=>s.file_id===hit.file_id)) sources.push({file_id:hit.file_id,filename:name});
    }
    for(const part of item.content||[]) for(const ann of part.annotations||[]) {
      if(ann.type==="file_citation" && !sources.some(s=>s.file_id===ann.file_id))
        sources.push({file_id:ann.file_id,filename:ann.filename||"Documento"});
    }
  }
  if(!answer) return json({error:"La IA no ha devuelto texto. Reformula la consulta."},502);
  return json({answer,sources,library_connected:!!env.OPENAI_VECTOR_STORE_ID,model:result.model||env.OPENAI_MODEL||"gpt-4.1-mini"});
}
export async function onRequestGet(){return json({error:"Método no permitido."},405);}
