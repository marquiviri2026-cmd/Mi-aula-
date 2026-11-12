const MAX_BODY = 24000;
const MAX_PROMPT = 12000;
const MAX_HISTORY = 8;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function equalSecret(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b))
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin");
  const requestOrigin = new URL(request.url).origin;
  if (origin && origin !== requestOrigin) return json({ error: "Origen no permitido." }, 403);

  if (!env.OPENAI_API_KEY) return json({ error: "Falta configurar OPENAI_API_KEY en Cloudflare." }, 503);
  if (!env.MIAULA_ACCESS_TOKEN) return json({ error: "El acceso seguro del asistente aún no está configurado." }, 503);

  const supplied = request.headers.get("X-MIAULA-TOKEN") || "";
  if (!(await equalSecret(supplied, env.MIAULA_ACCESS_TOKEN))) {
    return json({ error: "Acceso no autorizado. Comprueba tu código de acceso." }, 401);
  }

  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_BODY) return json({ error: "La petición supera el tamaño permitido." }, 413);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: "La petición no contiene JSON válido." }, 400); }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return json({ error: "Escribe una consulta antes de enviar." }, 400);
  if (prompt.length > MAX_PROMPT) return json({ error: "La consulta es demasiado larga (máximo 12.000 caracteres)." }, 413);

  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY) : [];
  const safeHistory = history
    .filter(m => m && ["user", "assistant"].includes(m.role) && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));

  const instructions = [
    "Eres el asistente pedagógico de MI AULA, una aplicación privada de apoyo docente.",
    "Responde en español claro, preciso y práctico. Adapta propuestas a Educación Primaria y a aulas multinivel cuando el usuario lo indique.",
    "No inventes normativa, citas, autores, resultados de investigación ni referencias. Distingue hechos, propuestas e incertidumbres.",
    "Cuando falte información esencial, pregunta solo lo imprescindible. No afirmes haber consultado documentos que no se hayan adjuntado o proporcionado.",
    "No solicites nombres, apellidos, direcciones, diagnósticos ni otros datos identificativos de menores. Recomienda usar códigos anónimos.",
    "Para pruebas, fichas, rúbricas y materiales, estructura el resultado para que pueda copiarse e imprimirse. Si se solicita solucionario, sepáralo claramente del material del alumnado.",
    "No afirmes que has guardado, publicado o enviado archivos si no se ha realizado esa acción."
  ].join("\n");

  const input = [
    ...safeHistory.map(m => ({ role: m.role, content: [{ type: "input_text", text: m.content }] })),
    { role: "user", content: [{ type: "input_text", text: prompt }] }
  ];

  let upstream;
  try {
    upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + env.OPENAI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-4.1-mini",
        instructions,
        input,
        max_output_tokens: 2200,
        store: false
      })
    });
  } catch {
    return json({ error: "No se pudo conectar con el servicio de IA. Inténtalo de nuevo." }, 502);
  }

  const raw = await upstream.text();
  let result;
  try { result = JSON.parse(raw); } catch { result = {}; }
  if (!upstream.ok) {
    const message = result?.error?.message || "El proveedor de IA ha rechazado la petición.";
    return json({ error: message.slice(0, 500) }, upstream.status === 429 ? 429 : 502);
  }

  const answer = (result.output || [])
    .flatMap(item => item.content || [])
    .filter(part => part.type === "output_text")
    .map(part => part.text || "")
    .join("\n")
    .trim();

  if (!answer) return json({ error: "La IA no ha devuelto texto. Prueba a reformular la consulta." }, 502);
  return json({ answer, model: result.model || env.OPENAI_MODEL || "gpt-4.1-mini" });
}

export async function onRequestGet() { return json({ error: "Método no permitido." }, 405); }
