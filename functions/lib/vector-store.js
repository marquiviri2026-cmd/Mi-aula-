const STORE_NAME = "MI AULA · Biblioteca docente";
async function requestOpenAI(env, path, options = {}) {
  return fetch("https://api.openai.com/v1" + path, {
    ...options,
    headers: { Authorization: "Bearer " + env.OPENAI_API_KEY, ...(options.headers || {}) }
  });
}
export async function findLibraryStore(env) {
  if (env.OPENAI_VECTOR_STORE_ID) return { id: env.OPENAI_VECTOR_STORE_ID, created: false };
  const response = await requestOpenAI(env, "/vector_stores?limit=100");
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "No se pudieron recuperar las bibliotecas existentes.");
  const matches = (data.data || []).filter(store => store.name === STORE_NAME);
  if (!matches.length) return null;
  matches.sort((a, b) => (b.file_counts?.total || 0) - (a.file_counts?.total || 0) || (a.created_at || 0) - (b.created_at || 0));
  return { id: matches[0].id, created: false, recovered: true };
}
export async function getOrCreateLibraryStore(env) {
  const existing = await findLibraryStore(env);
  if (existing) return existing;
  const response = await requestOpenAI(env, "/vector_stores", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: STORE_NAME })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "No se pudo crear la biblioteca.");
  return { id: data.id, created: true };
}
