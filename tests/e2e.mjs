import { chromium } from "playwright";
import assert from "node:assert/strict";

const base = process.env.BASE_URL || "https://preparacion-asistente-openai.mi-aula.pages.dev";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", error => pageErrors.push(error.message));
page.on("dialog", dialog => dialog.accept());

async function jsonResponse(response, label) {
  const type = response.headers()["content-type"] || "";
  assert.match(type, /application\/json/i, label + " debe devolver JSON");
  return response.json();
}

try {
  let response;
  for (let attempt = 0; attempt < 18; attempt++) {
    try {
      response = await page.goto(base, { waitUntil: "domcontentloaded", timeout: 20000 });
      if (response && response.ok()) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  assert.ok(response && response.ok(), "La web de Preview debe responder HTTP 200");
  await page.waitForSelector("#page-inicio");
  assert.match(await page.title(), /MI AULA/i);

  const sections = ["inicio", "horario", "agenda", "grupos", "programacion", "evaluacion", "biblioteca", "asistente", "ajustes"];
  for (const section of sections) {
    await page.locator('[data-page="' + section + '"]').click();
    await page.locator("#page-" + section).waitFor({ state: "visible" });
  }

  const catalogResponse = await page.request.get(base + "/criterios-extremadura.json");
  assert.equal(catalogResponse.status(), 200, "El catálogo curricular debe responder HTTP 200");
  const catalog = await catalogResponse.json();
  assert.ok(Array.isArray(catalog.criteria) && catalog.criteria.length > 0, "El catálogo curricular debe contener criterios");

  const apiChecks = [
    ["/api/library", "GET", undefined, [400, 503]],
    ["/api/library-search", "GET", undefined, [405]],
    ["/api/library-search", "POST", { query: "prueba segura sin credenciales" }, [400, 503]],
    ["/api/assistant", "POST", { prompt: "prueba segura sin credenciales", history: [] }, [400, 503]],
    ["/api/competency-evaluate", "POST", {}, [401, 503]],
    ["/api/evaluate", "POST", {}, [401, 503]]
  ];
  for (const [path, method, body, allowed] of apiChecks) {
    const r = await page.request.fetch(base + path, {
      method,
      headers: { "Origin": base, ...(body ? { "Content-Type": "application/json" } : {}) },
      data: body
    });
    assert.ok(allowed.includes(r.status()), path + " debe rechazar la petición sin credenciales de forma controlada; HTTP " + r.status());
    await jsonResponse(r, path);
  }

  await page.locator('[data-page="agenda"]').click();
  await page.getByRole("button", { name: /Nueva actividad/ }).click();
  await page.locator('#eventForm input[name="title"]').fill("QA · evento temporal");
  await page.locator('#eventForm input[name="date"]').fill("2026-11-20");
  await page.locator('#eventForm input[name="time"]').fill("10:30");
  await page.locator('#eventForm input[name="group"]').fill("Grupo de prueba");
  await page.locator('#eventForm input[name="notes"]').fill("Registro temporal de test automatizado");
  await page.locator('#eventForm button.btn.primary').click();
  await page.locator("#eventsList").getByText("QA · evento temporal").waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-page="agenda"]').click();
  await page.locator("#eventsList").getByText("QA · evento temporal").waitFor();
  await page.locator("#eventsList").getByRole("button", { name: "Eliminar" }).click();
  await page.locator("#eventsList").getByText("QA · evento temporal").waitFor({ state: "detached" });

  await page.locator('[data-page="grupos"]').click();
  await page.getByRole("button", { name: /Añadir grupo/ }).click();
  await page.locator('#groupForm input[name="name"]').fill("QA · grupo temporal");
  await page.locator('#groupForm input[name="levels"]').fill("Prueba");
  await page.locator('#groupForm input[name="subjects"]').fill("Prueba funcional");
  await page.locator('#groupForm input[name="count"]').fill("2");
  await page.locator('#groupForm button.btn.primary').click();
  await page.locator("#groupsList").getByText("QA · grupo temporal").waitFor();
  await page.locator("#groupsList").getByRole("button", { name: "Eliminar" }).first().click();
  await page.locator("#groupsList").getByText("QA · grupo temporal").waitFor({ state: "detached" });

  await page.locator('[data-page="horario"]').click();
  await page.locator('#scheduleTable td[onclick*="Martes"][onclick*="09:00"]').click();
  let scheduleData = await page.evaluate(() => JSON.parse(localStorage.getItem("miaula_v3_data") || "{}"));
  assert.ok(!scheduleData.slots.some(x => x.day === "Martes" && x.start === "09:00"), "La eliminación de una clase debe guardarse");
  await page.getByRole("button", { name: /Añadir clase/ }).click();
  await page.locator('#slotForm select[name="day"]').selectOption("Martes");
  await page.locator('#slotForm input[name="start"]').fill("09:00");
  await page.locator('#slotForm input[name="end"]').fill("10:00");
  await page.locator('#slotForm input[name="subject"]').fill("QA · clase temporal");
  await page.locator('#slotForm input[name="group"]').fill("Grupo de prueba");
  await page.locator('#slotForm button.btn.primary').click();
  await page.locator("#scheduleTable").getByText("QA · clase temporal").waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  scheduleData = await page.evaluate(() => JSON.parse(localStorage.getItem("miaula_v3_data") || "{}"));
  assert.ok(scheduleData.slots.some(x => x.subject === "QA · clase temporal"), "La clase debe persistir tras recargar");
  await page.locator('[data-page="horario"]').click();
  await page.locator('#scheduleTable td[onclick*="Martes"][onclick*="09:00"]').click();
  scheduleData = await page.evaluate(() => JSON.parse(localStorage.getItem("miaula_v3_data") || "{}"));
  assert.ok(!scheduleData.slots.some(x => x.subject === "QA · clase temporal"), "La clase temporal debe poder eliminarse");

  await page.locator('[data-page="programacion"]').click();
  await page.getByRole("button", { name: /Nueva planificación/ }).click();
  await page.locator('#planForm input[name="title"]').fill("QA · planificación temporal");
  await page.locator('#planForm input[name="group"]').fill("4.º Primaria");
  await page.locator('#planForm input[name="subject"]').fill("Matemáticas");
  await page.locator('#planForm input[name="period"]').fill("Prueba automática");
  await page.locator('#planForm textarea[name="notes"]').fill("Contenido temporal para comprobar guardado local.");
  await page.locator('#planForm button.btn.primary').click();
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem("miaula_v3_data") || "{}"));
  assert.ok(saved.plans.some(x => x.title === "QA · planificación temporal"), "La programación debe guardarse en localStorage");
  await page.reload({ waitUntil: "domcontentloaded" });
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("miaula_v3_data") || "{}"));
  assert.ok(saved.plans.some(x => x.title === "QA · planificación temporal"), "La programación debe persistir tras recargar");

  await page.evaluate(() => showPage("evaluacion"));
  await page.locator("#page-evaluacion").waitFor({ state: "visible" });
  await page.locator("#criteriaReferencePanel").evaluate(el => { el.open = true; });
  await page.locator("#criterionForm").waitFor({ state: "visible" });
  await page.locator('#criterionForm input[name="code"]').fill("QA.TEST.1");
  await page.locator('#criterionForm select[name="grade"]').selectOption("4.º");
  await page.locator('#criterionForm select[name="subject"]').selectOption("Matemáticas");
  await page.locator('#criterionForm textarea[name="description"]').fill("Criterio temporal para prueba automatizada.");
  await page.locator('#criterionForm input[name="weight"]').fill("10");
  await page.locator('#criterionForm button.btn.primary').click();
  await page.locator("#evalGroup").selectOption("4.º Primaria");
  await page.locator("#evalSubject").selectOption("Matemáticas");
  await page.locator("#criteriaList").getByText("QA.TEST.1").waitFor();
  await page.locator('#criteriaList .rowitem:has-text("QA.TEST.1") button').click();
  let criterionData = await page.evaluate(() => JSON.parse(localStorage.getItem("miaula_v3_data") || "{}"));
  assert.ok(!criterionData.criteria.some(x => x.code === "QA.TEST.1"), "El criterio personalizado debe poder eliminarse");

  await page.locator("#registerEvidencePanel > summary").click();
  await page.locator('#gradeForm input[name="student"]').fill("QA-01");
  await page.locator('#gradeForm select[name="group"]').selectOption("4.º, 5.º y 6.º Primaria");
  await page.locator('#gradeForm select[name="subject"]').selectOption("Matemáticas");
  await page.locator('#gradeForm select[name="term"]').selectOption("1.º trimestre");
  await page.locator('#gradeForm input[name="score"]').fill("8.5");
  await page.locator('#gradeForm textarea[name="notes"]').fill("Evidencia temporal de test: resuelve operaciones correctamente.");
  await page.locator('#gradeForm button.btn.primary').click();
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("miaula_v3_data") || "{}"));
  assert.ok(saved.grades.some(x => x.student === "QA-01" && x.score === "8.5"), "La evidencia debe guardarse con su nota");
  await page.reload({ waitUntil: "domcontentloaded" });
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("miaula_v3_data") || "{}"));
  assert.ok(saved.grades.some(x => x.student === "QA-01"), "La evidencia debe persistir tras recargar");

  await page.locator('[data-page="ajustes"]').click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Descargar copia JSON/ }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /\.json$/i, "La copia de seguridad debe descargarse como JSON");

  const backup = await page.evaluate(() => localStorage.getItem("miaula_v3_data"));
  await page.locator('[data-page="evaluacion"]').click();
  await page.locator("#historyGroup").selectOption("5.º y 6.º Primaria");
  await page.locator("#historySubject").selectOption("Matemáticas");
  await page.locator("#historyTerm").selectOption("1.º trimestre");
  await page.locator("#evalStudentSearch").fill("QA-01");
  await page.locator("#gradesList").getByRole("button").click();
  let afterDelete = await page.evaluate(() => JSON.parse(localStorage.getItem("miaula_v3_data") || "{}"));
  assert.ok(!afterDelete.grades.some(x => x.student === "QA-01"), "La evidencia debe poder eliminarse desde el historial");
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem("miaula_v3_data")); d.events = []; d.plans = []; d.grades = []; localStorage.setItem("miaula_v3_data", JSON.stringify(d)); });
  await page.locator("#importInput").setInputFiles({
    name: "mi-aula-prueba.json",
    mimeType: "application/json",
    buffer: Buffer.from(backup, "utf8")
  });
  await page.waitForFunction(() => { const d = JSON.parse(localStorage.getItem("miaula_v3_data") || "{}"); return d.plans?.some(x => x.title === "QA · planificación temporal") && d.grades?.some(x => x.student === "QA-01"); });
  saved = await page.evaluate(() => JSON.parse(localStorage.getItem("miaula_v3_data") || "{}"));
  assert.ok(saved.grades.some(x => x.student === "QA-01"), "La restauración debe recuperar datos de la copia");
  assert.ok(saved.plans.some(x => x.title === "QA · planificación temporal"), "La restauración debe recuperar programaciones");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => showPage("inicio"));
  assert.ok(await page.locator("#page-inicio").isVisible(), "La vista inicial debe seguir visible en móvil");
  const mobileWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(mobileWidth <= 390, "La página no debe desbordarse horizontalmente en móvil; ancho: " + mobileWidth);

  assert.deepEqual(pageErrors, [], "No deben producirse errores JavaScript no controlados: " + pageErrors.join(" | "));
  console.log("E2E OK: carga, navegación de 9 módulos, catálogo, 6 comprobaciones API seguras, alta/guardado/recarga/borrado de agenda y grupos, persistencia de programación y evaluación, exportación/restauración JSON y vista móvil.");
} finally {
  await browser.close();
}
