import { readFileSync, readdirSync } from "node:fs";
import { Script } from "node:vm";
import assert from "node:assert/strict";

const html = readFileSync("index.html", "utf8");
const catalog = JSON.parse(readFileSync("criterios-extremadura.json", "utf8"));

const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]);
assert.ok(ids.length > 0, "La interfaz debe contener elementos identificables");
const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
assert.deepEqual([...new Set(duplicates)], [], "No debe haber IDs HTML duplicados");

for (const match of html.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)) {
  assert.ok(ids.includes(match[1]), \`Falta el elemento #\${match[1]} utilizado por JavaScript\`);
}

const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
assert.equal(scripts.length, 1, "Se espera un único script integrado");
new Script(scripts[0][1], { filename: "index.html:inline-script" });

const apiFiles = readdirSync("functions/api").filter((name) => name.endsWith(".js"));
for (const route of ["assistant.js", "library.js", "library-search.js", "competency-evaluate.js", "evaluate.js"]) {
  assert.ok(apiFiles.includes(route), \`Falta la ruta API /api/\${route.replace(".js", "")}\`);
  const source = readFileSync(\`functions/api/\${route}\`, "utf8");
  assert.match(source, /export async function onRequestPost/, \`\${route} debe implementar POST\`);
}

for (const route of ["assistant", "library", "library-search", "competency-evaluate", "evaluate"]) {
  assert.ok(html.includes(\`/api/\${route}\`), \`La interfaz no referencia /api/\${route}\`);
}

assert.ok(Array.isArray(catalog.criteria) && catalog.criteria.length > 0, "El catálogo curricular debe tener criterios");
const subjects = new Set(catalog.criteria.map((item) => item.subject));
const cycles = new Set(catalog.criteria.map((item) => item.grade));
for (const subject of ["Matemáticas", "Lengua", "Conocimiento del Medio", "Educación Física"]) {
  assert.ok(subjects.has(subject), \`El catálogo no contiene la materia \${subject}\`);
}
for (const cycle of ["Primer ciclo", "Segundo ciclo", "Tercer ciclo"]) {
  assert.ok(cycles.has(cycle), \`El catálogo no contiene \${cycle}\`);
}

const library = readFileSync("functions/api/library.js", "utf8");
assert.match(library, /const needsStoreId=store\.created/, "La inicialización debe detectar la creación del almacén");
assert.match(library, /needs_store_id:needsStoreId/, "La API debe informar de la configuración pendiente");
assert.ok(library.indexOf('openai(env,"/files"') < library.indexOf("return json({ok:true,needs_store_id"), "El primer archivo debe subirse antes de responder con el ID del almacén");

console.log("MI AULA: comprobaciones estáticas superadas.");
console.log(\`HTML: \${ids.length} IDs únicos · API: \${apiFiles.length} rutas · Criterios: \${catalog.criteria.length}\`);
