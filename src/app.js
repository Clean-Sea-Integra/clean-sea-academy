import QRCode from "qrcode";

/* CLEAN SEA Academy — generador de certificados (portado del artefacto) + cursos con inscripción por QR.
   C = núcleo PDF, sb = cliente Supabase, me = { id, email, nombre } del usuario logueado. */
export function iniciarApp(C, sb, me){
"use strict";
var $ = function(id){ return document.getElementById(id); };
var esc = function(s){ return String(s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); };

/* ── Descargas: directo del navegador ── */
var downloads = true;
async function save(filename, data){
  var url = URL.createObjectURL(data), a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function(){ URL.revokeObjectURL(url); }, 30000);
  toast("Descarga lista: " + filename); return true;
}

/* ── Utilidades ── */
var toastT;
function toast(t){ var el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(function(){ el.hidden = true; }, 4200); }
function msg(id, kind, html){ $(id).innerHTML = html ? '<div class="msg ' + kind + '">' + html + "</div>" : ""; }
function isoToAr(iso){ if (!iso) return ""; var p = iso.split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : ""; }
function nowAr(){ var d = new Date(), z = function(n){ return String(n).padStart(2,"0"); }; return z(d.getDate()) + "/" + z(d.getMonth()+1) + "/" + d.getFullYear() + " " + z(d.getHours()) + ":" + z(d.getMinutes()); }
function normKey(s){ return C.stripAccents(C.clean(s)).toLowerCase(); }
function blobPdf(bytes){ return new Blob([bytes], { type: "application/pdf" }); }
function modal(title, bodyHtml, buttons){
  return new Promise(function(res){
    $("mdTitle").textContent = title; $("mdBody").innerHTML = bodyHtml; var b = $("mdBtns"); b.innerHTML = "";
    buttons.forEach(function(x){ var e = document.createElement("button"); e.type = "button"; e.className = "btn" + (x.primary ? " primary" : ""); e.textContent = x.label;
      e.onclick = function(){ $("modal").hidden = true; res(x.value); }; b.appendChild(e); });
    $("modal").hidden = false; b.lastChild.focus();
  });
}
document.addEventListener("keydown", function(e){ if (e.key === "Escape" && !$("modal").hidden){ var bs = $("mdBtns").querySelectorAll("button"); if (bs.length) bs[0].click(); } });

/* ── Pestañas ── */
var tabs = ["cur","ind","mas","pre","des","reg"];
function showTab(k){
  tabs.forEach(function(t){ $("t-"+t).setAttribute("aria-selected", t === k ? "true" : "false"); $("p-"+t).hidden = t !== k; });
  if (k === "pre") refreshPreviewList(true);
  if (k === "reg") renderReg();
  if (k === "cur") renderCursos();
}
tabs.forEach(function(t){ $("t-"+t).addEventListener("click", function(){ showTab(t); }); });

/* ── Render con pdf.js del mismo PDF que se descarga ── */
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
var renderSeq = {};
async function renderPdf(canvas, bytes){
  var seq = (renderSeq[canvas.id] || 0) + 1; renderSeq[canvas.id] = seq;
  var doc = await pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise;
  var page = await doc.getPage(1);
  if (renderSeq[canvas.id] !== seq){ doc.destroy(); return; }
  var vp0 = page.getViewport({ scale: 1 });
  var target = Math.min(2400, Math.max(1200, canvas.clientWidth * (window.devicePixelRatio || 1)));
  var vp = page.getViewport({ scale: target / vp0.width });
  var off = document.createElement("canvas"); off.width = Math.round(vp.width); off.height = Math.round(vp.height);
  await page.render({ canvasContext: off.getContext("2d"), viewport: vp }).promise;
  if (renderSeq[canvas.id] !== seq){ doc.destroy(); return; }
  canvas.width = off.width; canvas.height = off.height; canvas.getContext("2d").drawImage(off, 0, 0);
  doc.destroy();
}
function notesHtml(info){
  var h = [];
  if (!info) return "";
  if (info.name){ if (!info.name.fits) h.push('<span class="pill err">El nombre no entra en el espacio</span>');
    else if (info.name.lines > 1) h.push('<span class="pill warn">Nombre en ' + info.name.lines + " líneas</span>");
    else h.push('<span class="pill ok">Nombre en una línea</span>'); }
  if (info.title){ if (!info.title.fits) h.push('<span class="pill err">El título no entra en el espacio</span>');
    else h.push('<span class="pill ' + (info.title.reduced ? "warn" : "ok") + '">Título en ' + info.title.lines + (info.title.lines > 1 ? " líneas" : " línea") + (info.title.reduced ? ", letra reducida a " + info.title.size + " pt" : "") + "</span>"); }
  if (info.name && info.name.reduced && info.name.fits) h.push('<span class="pill warn">Nombre con letra reducida a ' + info.name.size + " pt</span>");
  return h.join("");
}

/* ═════════ 1 · INDIVIDUAL ═════════ */
var ind = { last: null, history: [], used: new Set() };
function indValues(){ return { title: $("iTitle").value, date: isoToAr($("iDate").value), name: $("iName").value, company: $("iCompany").value }; }
var indT;
function indPreview(){
  clearTimeout(indT);
  indT = setTimeout(async function(){
    var v = indValues();
    try {
      var r = await C.generate({ name: v.name, title: v.title, date: v.date, preview: true });
      await renderPdf($("iCanvas"), r.bytes); $("iNotes").innerHTML = notesHtml(r.info);
    } catch(e){ $("iNotes").innerHTML = '<span class="pill err">' + esc(e.message) + "</span>"; }
  }, 350);
}
["iTitle","iDate","iName","iCompany"].forEach(function(id){ $(id).addEventListener("input", function(){ ind.last = null; $("iDl").disabled = true; indPreview(); }); });
$("indForm").addEventListener("submit", async function(e){
  e.preventDefault();
  var v = indValues(), miss = [];
  if (!C.clean(v.title)) miss.push("título del curso"); if (!v.date) miss.push("fecha"); if (!C.clean(v.name)) miss.push("nombre y apellido"); if (!C.clean(v.company)) miss.push("empresa");
  if (miss.length){ msg("iMsg","err","Completá: " + miss.join(", ") + "."); return; }
  var bad = C.unsupported(v.name + v.title + v.company);
  if (bad.length){ msg("iMsg","err","Hay caracteres que la tipografía del certificado no tiene: " + esc(bad.join(" ")) + ". Reemplazalos y volvé a generar."); return; }
  try {
    var r = await C.generate(v); await C.verify(r.bytes);
    if (r.info.name && !r.info.name.fits){ msg("iMsg","err","El nombre es demasiado largo para el espacio del certificado. Abreviá un segundo nombre o apellido."); return; }
    var course = C.clean(v.title);
    var fname = C.uniqueName(ind.used, "", C.fileName(v.company, v.name, C.shortCourse(course)));
    ind.last = { bytes: r.bytes, fname: fname };
    ind.history.push({ n: ind.history.length + 1, company: C.clean(v.company), name: C.clean(v.name), course: course, date: v.date, emitted: nowAr(), fname: fname, status: "Generado", bytes: r.bytes });
    await renderPdf($("iCanvas"), r.bytes); $("iNotes").innerHTML = notesHtml(r.info);
    $("iCap").innerHTML = "<b>Archivo:</b> " + esc(fname);
    $("iDl").disabled = false;
    var hx = ind.history[ind.history.length - 1];
    var code = newCode();
    hx.lote = code;
    var sr = await saveRecord(code, "individual", { title: course, date: v.date, iso: $("iDate").value, short: C.shortCourse(course) }, [hx]);
    msg("iMsg", sr.ok ? "ok" : "warn", sr.ok ? "Certificado generado y guardado en el registro (" + esc(code) + "). Ya podés descargarlo." : "Certificado generado, pero <b>no quedó guardado en el registro</b>: " + esc(sr.msg) + " Descargá el registro de individuales como respaldo.");
    renderIndList();
  } catch(err){ msg("iMsg","err","No se pudo generar: " + esc(err.message)); }
});
$("iDl").addEventListener("click", function(){ if (ind.last) save(ind.last.fname, blobPdf(ind.last.bytes)); });
function renderIndList(){
  var h = ind.history;
  $("indReg").disabled = !h.length;
  if (!h.length){ $("indList").textContent = "Ninguno todavía."; return; }
  $("indList").innerHTML = '<div class="files">' + h.slice().reverse().map(function(x){ return '<div class="fr"><span class="fn">' + esc(x.fname) + '</span><button class="btn ghost" type="button" data-ind="' + (x.n - 1) + '">Descargar</button></div>'; }).join("") + "</div>";
}
$("indList").addEventListener("click", function(e){ var b = e.target.closest("[data-ind]"); if (!b) return; var x = ind.history[+b.dataset.ind]; save(x.fname, blobPdf(x.bytes)); });
$("indReg").addEventListener("click", function(){ save("Registro de Emisión - CLEAN SEA Academy (individuales).xlsx", registro(ind.history)); });

/* ═════════ 2 · MASIVO ═════════ */
var rows = []; var seq = 0; var selected = new Set();
function newRow(company, name){ seq++; return { id: seq, n: seq, company: C.clean(company), name: C.clean(name), status: null }; }
function course(){ return { title: C.clean($("mTitle").value), date: isoToAr($("mDate").value), iso: $("mDate").value }; }
function courseShort(){ var s = C.clean($("mShort").value); return s ? C.fsSafe(s) : C.shortCourse(course().title); }
function updShortHint(){ var t = course().title; $("mShortHint").textContent = t ? "ZIP: «CLEAN SEA ACADEMY - " + courseShort() + " - fecha»" : "Si queda vacío se usa el título, abreviado."; }
var revT; function scheduleRevalidate(){ clearTimeout(revT); revT = setTimeout(function(){ if (rows.length) refresh(); }, 600); }
["mTitle","mShort"].forEach(function(id){ $(id).addEventListener("input", function(){ updShortHint(); validateCourse(); schedulePreview(); scheduleRevalidate(); }); });
$("mDate").addEventListener("input", function(){ validateCourse(); schedulePreview(); scheduleRevalidate(); });

async function validateCourse(){
  var c = course(), out = [];
  if (c.title){ var bad = C.unsupported(c.title); if (bad.length) out.push("El título tiene caracteres que la tipografía no admite: " + esc(bad.join(" ")));
    else { var k = await C.check(null, c.title); if (!k.title.fits) out.push("El título es demasiado extenso para el certificado: acortalo."); else if (k.title.reduced) out.push("El título ocupa " + k.title.lines + " líneas con letra reducida a " + k.title.size + " pt. Revisalo en la vista previa."); } }
  msg("mCourseMsg", out.length ? "warn" : "", out.join("<br>"));
  return out;
}

async function validateAll(){
  var groups = {};
  rows.forEach(function(r){ var k = normKey(r.name); if (k) (groups[k] = groups[k] || []).push(r); });
  for (var i = 0; i < rows.length; i++){
    var r = rows[i], errs = [], warns = [];
    if (!r.company) errs.push("Falta empresa");
    if (!r.name) errs.push("Falta nombre");
    if (/^\s*ejemplo\b/i.test(r.name) || /^\s*ejemplo\b/i.test(r.company)) errs.push("Fila de ejemplo");
    var bad = C.unsupported(r.name + r.company);
    if (bad.length) errs.push("Caracteres no admitidos: " + bad.join(" "));
    else if (r.name){
      var k = await C.check(r.name, null);
      if (!k.name.fits) errs.push("Nombre demasiado largo");
      else if (k.name.lines > 1) warns.push("Nombre en 2 líneas");
    }
    var dup = r.name && groups[normKey(r.name)].length > 1;
    if (r.name && r.name.split(" ").length < 2) warns.push("Sólo una palabra");
    var hk = histKey(r.name);
    if (hk && emittedIdx[hk]) warns.push("Ya emitido para este curso y fecha (" + emittedIdx[hk] + ")");
    r.status = { errs: errs, warns: warns, dup: dup };
  }
}
function statusHtml(s){
  if (!s) return "";
  var h = s.errs.map(function(e){ return '<span class="pill err">' + esc(e) + "</span>"; });
  if (s.dup) h.push('<span class="pill warn">Posible duplicado</span>');
  s.warns.forEach(function(w){ h.push('<span class="pill warn">' + esc(w) + "</span>"); });
  if (!s.errs.length && !s.dup && !s.warns.length) h.push('<span class="pill ok">Válido</span>');
  return h.join("");
}
function visibleRows(){
  var q = normKey($("q").value), co = $("fCo").value, st = $("fSt").value, sort = $("sortBy").value;
  var v = rows.filter(function(r){
    if (q && normKey(r.name).indexOf(q) < 0 && normKey(r.company).indexOf(q) < 0) return false;
    if (co && r.company.toUpperCase() !== co) return false;
    if (st === "err" && !(r.status && r.status.errs.length)) return false;
    if (st === "dup" && !(r.status && r.status.dup)) return false;
    if (st === "ok" && !(r.status && !r.status.errs.length)) return false;
    return true;
  });
  var coll = new Intl.Collator("es", { sensitivity: "base" });
  if (sort === "name") v.sort(function(a,b){ return coll.compare(a.name, b.name); });
  if (sort === "company") v.sort(function(a,b){ return coll.compare(a.company, b.company) || coll.compare(a.name, b.name); });
  return v;
}
function renderTable(){
  var v = visibleRows();
  $("emptyState").hidden = rows.length > 0;
  $("tbody").innerHTML = v.map(function(r){
    return '<tr data-id="' + r.id + '"' + (selected.has(r.id) ? ' class="sel"' : "") + '>' +
      '<td class="chk"><input type="checkbox" data-sel aria-label="Seleccionar ' + esc(r.name || "registro " + r.n) + '"' + (selected.has(r.id) ? " checked" : "") + "></td>" +
      '<td class="num">' + r.n + "</td>" +
      '<td><input type="text" data-f="company" value="' + esc(r.company) + '" aria-label="Empresa del registro ' + r.n + '"></td>' +
      '<td><input type="text" data-f="name" value="' + esc(r.name) + '" aria-label="Nombre del registro ' + r.n + '"></td>' +
      '<td class="st">' + statusHtml(r.status) + "</td>" +
      '<td class="act"><button class="btn ghost" type="button" data-view>Ver</button><button class="btn ghost danger" type="button" data-del aria-label="Eliminar registro ' + r.n + '">Eliminar</button></td></tr>';
  }).join("");
  if (rows.length && !v.length) $("tbody").innerHTML = '<tr><td colspan="6" class="empty">Ningún registro coincide con la búsqueda o los filtros.</td></tr>';
  $("selAll").checked = v.length > 0 && v.every(function(r){ return selected.has(r.id); });
  updateCounts();
}
function updateCounts(){
  var err = rows.filter(function(r){ return r.status && r.status.errs.length; }).length;
  var dup = rows.filter(function(r){ return r.status && r.status.dup; }).length;
  $("kTotal").textContent = rows.length; $("kOk").textContent = rows.length - err; $("kErr").textContent = err; $("kDup").textContent = dup; $("kSel").textContent = selected.size;
  $("tabCount").textContent = rows.length;
  $("delSel").disabled = !selected.size; $("clearAll").disabled = !rows.length;
  var cos = Array.from(new Set(rows.map(function(r){ return r.company.toUpperCase(); }).filter(Boolean))).sort();
  var cur = $("fCo").value;
  $("fCo").innerHTML = '<option value="">Todas las empresas</option>' + cos.map(function(c){ return '<option value="' + esc(c) + '"' + (c === cur ? " selected" : "") + ">" + esc(c) + "</option>"; }).join("");
  var scope = selected.size ? selected.size + " seleccionados" : rows.length + " participantes";
  $("genScope").textContent = rows.length ? "Se emitirán: " + scope : "";
}
async function refresh(){ await validateAll(); renderTable(); refreshPreviewList(false); }

$("tbody").addEventListener("change", function(e){
  var tr = e.target.closest("tr[data-id]"); if (!tr) return;
  var r = rows.find(function(x){ return x.id === +tr.dataset.id; }); if (!r) return;
  if (e.target.matches("[data-sel]")){ if (e.target.checked) selected.add(r.id); else selected.delete(r.id); tr.classList.toggle("sel", e.target.checked); updateCounts(); return; }
  var f = e.target.dataset.f; if (f){ r[f] = C.clean(e.target.value); invalidateBatch(); refresh(); }
});
$("tbody").addEventListener("click", function(e){
  var tr = e.target.closest("tr[data-id]"); if (!tr) return; var id = +tr.dataset.id;
  if (e.target.closest("[data-del]")){ rows = rows.filter(function(x){ return x.id !== id; }); selected.delete(id); invalidateBatch(); refresh(); }
  if (e.target.closest("[data-view]")){ pv.source = "mas"; pv.id = id; showTab("pre"); }
});
$("selAll").addEventListener("change", function(e){ visibleRows().forEach(function(r){ if (e.target.checked) selected.add(r.id); else selected.delete(r.id); }); renderTable(); });
["q","fCo","fSt","sortBy"].forEach(function(id){ $(id).addEventListener("input", renderTable); });
$("addBtn").addEventListener("click", function(){
  var r = newRow("", ""); rows.push(r); $("q").value = ""; $("fCo").value = ""; $("fSt").value = ""; invalidateBatch();
  refresh().then(function(){ var tr = document.querySelector('tr[data-id="' + r.id + '"] input[data-f="company"]'); if (tr){ tr.focus(); tr.scrollIntoView({ block: "nearest" }); } });
});
$("delSel").addEventListener("click", async function(){
  var n = selected.size; if (!n) return;
  var ok = await modal("Eliminar " + n + " registros", "<p>Se quitan de la lista los participantes seleccionados.</p>", [{ label: "Cancelar", value: false }, { label: "Eliminar " + n, value: true, primary: true }]);
  if (!ok) return; rows = rows.filter(function(r){ return !selected.has(r.id); }); selected.clear(); invalidateBatch(); refresh();
});
$("clearAll").addEventListener("click", async function(){
  var ok = await modal("Vaciar la lista", "<p>Se quitan los " + rows.length + " participantes cargados. Los certificados ya generados siguen en Descargas.</p>", [{ label: "Cancelar", value: false }, { label: "Vaciar lista", value: true, primary: true }]);
  if (!ok) return; rows = []; selected.clear(); seq = 0; refresh();
});

/* ── Importación ── */
function headerKey(s){ return C.stripAccents(String(s || "")).toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim(); }
function parseSheet(aoa){
  for (var h = 0; h < Math.min(aoa.length, 15); h++){
    var hdr = aoa[h].map(headerKey), ci = -1, ni = -1, fi = -1, li = -1;
    hdr.forEach(function(k, i){
      if (ci < 0 && /^(EMPRESA|COMPANIA|ORGANIZACION|COMPANY)$/.test(k)) ci = i;
      if (ni < 0 && /^(NOMBRE Y APELLIDO|APELLIDO Y NOMBRE|NOMBRE COMPLETO|NOMBRES Y APELLIDOS|APELLIDOS Y NOMBRES|PARTICIPANTE|ASISTENTE|FULL NAME|NAME)$/.test(k)) ni = i;
      if (fi < 0 && /^(NOMBRE|NOMBRES)$/.test(k)) fi = i;
      if (li < 0 && /^(APELLIDO|APELLIDOS)$/.test(k)) li = i;
    });
    if (ci >= 0 && (ni >= 0 || (fi >= 0 && li >= 0))){
      var out = [];
      for (var r = h + 1; r < aoa.length; r++){
        var row = aoa[r], co = row[ci], nm = ni >= 0 ? row[ni] : [row[fi], row[li]].join(" ");
        if (!C.clean(co) && !C.clean(nm)) continue;
        out.push([co, nm]);
      }
      return { rows: out, headerRow: h + 1 };
    }
  }
  return null;
}
async function readFile(file){
  var name = file.name.toLowerCase(), wb;
  if (/\.csv$/.test(name)){
    var buf = new Uint8Array(await file.arrayBuffer());
    var text = new TextDecoder("utf-8").decode(buf);
    if (text.indexOf("\uFFFD") >= 0) text = new TextDecoder("windows-1252").decode(buf);
    text = text.replace(/^\uFEFF/, "");
    var first = text.split(/\r?\n/)[0] || "";
    var fs = (first.split(";").length > first.split(",").length) ? ";" : ((first.split("\t").length > first.split(",").length) ? "\t" : ",");
    wb = XLSX.read(text, { type: "string", FS: fs, raw: true });
  } else if (/\.xlsx?$/.test(name)){
    wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
  } else throw new Error("Formato no admitido. Usá un archivo .xlsx o .csv.");
  for (var s = 0; s < wb.SheetNames.length; s++){
    var aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[s]], { header: 1, defval: "", raw: false });
    var p = parseSheet(aoa); if (p){ p.sheet = wb.SheetNames[s]; return p; }
  }
  throw new Error("No encontré las columnas EMPRESA y NOMBRE Y APELLIDO. Revisá los encabezados o usá la plantilla Excel.");
}
async function importFile(file){
  try {
    var p = await readFile(file);
    if (!p.rows.length){ msg("impMsg","warn","El archivo tiene encabezados pero ninguna fila con datos."); return; }
    var mode = "replace";
    if (rows.length){
      mode = await modal("Ya hay participantes cargados", "<p>El archivo trae " + p.rows.length + " registros. ¿Querés reemplazar la lista actual (" + rows.length + ") o agregarlos al final?</p>",
        [{ label: "Cancelar", value: null }, { label: "Agregar al final", value: "append" }, { label: "Reemplazar lista", value: "replace", primary: true }]);
      if (!mode) return;
    }
    if (mode === "replace"){ rows = []; selected.clear(); seq = 0; }
    p.rows.forEach(function(x){ rows.push(newRow(x[0], x[1])); });
    invalidateBatch(); await refresh();
    var ex = rows.filter(function(r){ return r.status.errs.indexOf("Fila de ejemplo") >= 0; }).length;
    msg("impMsg", ex ? "warn" : "ok", "Importados " + p.rows.length + " registros de «" + esc(file.name) + "» (hoja «" + esc(p.sheet) + "», encabezados en la fila " + p.headerRow + ")." + (ex ? " Hay " + ex + " filas de ejemplo de la plantilla: borralas antes de emitir." : ""));
  } catch(e){ msg("impMsg","err", esc(e.message)); }
}
$("fileIn").addEventListener("change", function(e){ var f = e.target.files[0]; if (f) importFile(f); e.target.value = ""; });
var drop = $("drop");
["dragenter","dragover"].forEach(function(ev){ drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.add("over"); }); });
["dragleave","drop"].forEach(function(ev){ drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.remove("over"); }); });
drop.addEventListener("drop", function(e){ var f = e.dataTransfer.files[0]; if (f) importFile(f); });

$("tplBtn").addEventListener("click", function(){
  var wb = XLSX.utils.book_new();
  var ws = XLSX.utils.aoa_to_sheet([["EMPRESA","NOMBRE Y APELLIDO"],["EJEMPLO - YPF","EJEMPLO - Juan Carlos Pérez"],["EJEMPLO - RAÍZEN","EJEMPLO - María González"],["EJEMPLO - EQUINOR","EJEMPLO - Pedro Martínez"]]);
  ws["!cols"] = [{ wch: 30 }, { wch: 45 }];
  XLSX.utils.book_append_sheet(wb, ws, "Participantes");
  var ins = XLSX.utils.aoa_to_sheet([["CLEAN SEA Academy — Plantilla de carga de participantes"],[""],["1. Completá una fila por participante en la hoja «Participantes»."],["2. EMPRESA: se usa para nombrar el archivo y el registro. No se imprime en el certificado."],["3. NOMBRE Y APELLIDO: tal como debe figurar en el certificado (con tildes y ñ)."],["4. Borrá las filas que empiezan con «EJEMPLO»: el generador no las emite."],["5. El título y la fecha del curso se cargan en el generador, no en este archivo."]]);
  ins["!cols"] = [{ wch: 95 }];
  XLSX.utils.book_append_sheet(wb, ins, "Instrucciones");
  save("Plantilla de participantes - CLEAN SEA Academy.xlsx", new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })]));
});

/* ── Generación del lote ── */
var batch = null;
function invalidateBatch(){ /* los cambios posteriores no alteran el lote ya generado */ }
$("genBtn").addEventListener("click", async function(){
  var c = course(), miss = [];
  if (!c.title) miss.push("el título del curso"); if (!c.date) miss.push("la fecha del curso");
  if (miss.length){ msg("genMsg","err","Falta " + miss.join(" y ") + " (Paso 1)."); return; }
  var cerr = await validateCourse();
  var k = await C.check(null, c.title);
  if (C.unsupported(c.title).length || !k.title.fits){ msg("genMsg","err","Corregí el título del curso antes de emitir."); return; }
  await validateAll(); renderTable();
  var set = rows.filter(function(r){ return !selected.size || selected.has(r.id); });
  if (!set.length){ msg("genMsg","err","No hay participantes para emitir."); return; }
  var bad = set.filter(function(r){ return r.status.errs.length; });
  if (bad.length){ msg("genMsg","err", bad.length + " registros tienen errores y no se pueden emitir. Corregilos o quitalos de la selección. <button class=\"btn ghost\" type=\"button\" id=\"showErr\">Ver errores</button>");
    $("showErr").onclick = function(){ $("fSt").value = "err"; renderTable(); }; return; }
  var dups = set.filter(function(r){ return r.status.dup; }).length;
  var ok = await modal("Generar " + set.length + " certificados",
    "<p><b>Curso:</b> " + esc(c.title) + "<br><b>Fecha:</b> " + esc(c.date) + "<br><b>Participantes:</b> " + set.length + (selected.size ? " (selección)" : "") + "</p>" +
    (dups ? '<div class="msg warn">Hay ' + dups + " registros marcados como posibles duplicados. Se emitirán igual; revisalos si no corresponde.</div>" : ""),
    [{ label: "Cancelar", value: false }, { label: "Generar " + set.length + " certificados", value: true, primary: true }]);
  if (!ok) return;
  runBatch(set, c);
});
async function runBatch(set, c){
  var btn = $("genBtn"); btn.disabled = true; $("prog").hidden = false; msg("genMsg","","");
  var used = new Set(), results = [], short = courseShort(), t0 = Date.now();
  for (var i = 0; i < set.length; i++){
    var r = set[i];
    $("progBar").style.width = (i / set.length * 100) + "%";
    $("progTxt").textContent = "Generando " + (i + 1) + " de " + set.length + " · " + r.name;
    var folder = C.cut(C.fsSafe(r.company), 40).toUpperCase() || "SIN EMPRESA";
    var fname = C.uniqueName(used, folder, C.fileName(r.company, r.name, short));
    var item = { n: i + 1, company: r.company, name: r.name, course: c.title, date: c.date, folder: folder, fname: fname, bytes: null, status: "", emitted: "" };
    try {
      var g = await C.generate({ name: r.name, title: c.title, date: c.date });
      await C.verify(g.bytes);
      item.bytes = g.bytes; item.status = "Generado"; item.emitted = nowAr();
    } catch(e){ item.status = "Error: " + e.message; }
    results.push(item);
    if (i % 3 === 2) await new Promise(function(res){ setTimeout(res, 0); });
  }
  var okN = results.filter(function(x){ return x.bytes; }).length;
  $("progBar").style.width = "100%";
  $("progTxt").textContent = okN + " de " + set.length + " certificados generados y verificados en " + ((Date.now() - t0) / 1000).toFixed(1) + " s";
  var code = newCode();
  results.forEach(function(x){ x.lote = code; });
  batch = { course: c, short: short, results: results, code: code };
  $("progTxt").textContent += " · guardando en el registro…";
  var sr = await saveRecord(code, "lote", { title: c.title, date: c.date, iso: c.iso, short: short }, results);
  $("progTxt").textContent = $("progTxt").textContent.replace(" · guardando en el registro…", sr.ok ? " · registrado como " + code : " · sin registrar");
  btn.disabled = false;
  renderDownloads();
  var base = okN === set.length ? "Listo: " + okN + " certificados. Descargalos en la pestaña Descargas." : (set.length - okN) + " certificados fallaron; quedan en el registro con su error. Revisalos en Descargas.";
  msg("genMsg", okN === set.length && sr.ok ? "ok" : "warn", base + (sr.ok ? " Lote guardado en el registro: <b>" + esc(code) + "</b>." : " <b>El lote no quedó guardado en la base de datos</b>: " + esc(sr.msg) + " Descargá el registro Excel como respaldo."));
  if (okN) showTab("des");
}

/* ═════════ 4 · DESCARGAS ═════════ */
function zipBase(){ return "CLEAN SEA ACADEMY - " + batch.short + " - " + batch.course.date.replace(/\//g, "-"); }
function renderDownloads(){
  var res = batch ? batch.results : [], ok = res.filter(function(x){ return x.bytes; });
  $("tabFiles").textContent = ok.length;
  if (!batch){ return; }
  $("dTitle").textContent = ok.length + " certificados · " + batch.course.title;
  var fails = res.length - ok.length;
  $("dSummary").innerHTML = "Fecha del curso: <b>" + esc(batch.course.date) + "</b> · " + new Set(ok.map(function(x){ return x.folder; })).size + " empresas" + (fails ? ' · <span style="color:var(--err-fg)">' + fails + " con error (no incluidos)</span>" : "");
  $("dActions").hidden = !ok.length;
  $("zipName1").textContent = zipBase() + ".zip";
  $("zipName2").textContent = zipBase() + " (sin carpetas).zip";
  $("filesCard").hidden = !res.length;
  renderFiles();
  refreshButtons();
}
function renderFiles(){
  if (!batch) return;
  var q = normKey($("fq").value);
  $("files").innerHTML = batch.results.map(function(x, i){
    if (q && normKey(x.fname + " " + x.name).indexOf(q) < 0) return "";
    return '<div class="fr"><span class="fo">' + esc(x.folder) + '/</span><span class="fn">' + esc(x.fname) + "</span>" +
      (x.bytes ? '<button class="btn ghost" type="button" data-f="' + i + '">Descargar</button>' : '<span class="pill err">' + esc(x.status) + "</span>") + "</div>";
  }).join("");
}
$("fq").addEventListener("input", renderFiles);
$("files").addEventListener("click", function(e){ var b = e.target.closest("[data-f]"); if (!b) return; var x = batch.results[+b.dataset.f]; save(x.fname, blobPdf(x.bytes)); });
function registro(list){
  var aoa = [["N.º de registro","Empresa","Nombre y apellido","Curso","Fecha del curso","Fecha de emisión","Archivo PDF","Estado de generación","Código de lote"]];
  list.forEach(function(x){ aoa.push([x.n, x.company, x.name, x.course, x.date, x.bytes ? x.emitted : "", x.bytes ? x.fname : "", x.bytes ? "Generado" : (x.status || "No generado"), x.lote || ""]); });
  var ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 8 }, { wch: 24 }, { wch: 34 }, { wch: 48 }, { wch: 14 }, { wch: 17 }, { wch: 60 }, { wch: 22 }, { wch: 26 }];
  ws["!autofilter"] = { ref: "A1:I" + aoa.length };
  var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Registro");
  return new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })]);
}
async function buildZip(byCompany){
  var zip = new JSZip(), ok = batch.results.filter(function(x){ return x.bytes; });
  ok.forEach(function(x){ zip.file((byCompany ? x.folder + "/" : "") + x.fname, x.bytes, { binary: true, date: new Date() }); });
  zip.file("Registro de Emisión - CLEAN SEA Academy.xlsx", registro(batch.results));
  var blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } }, function(m){ $("dlMsg").innerHTML = '<div class="msg info">Armando ZIP… ' + Math.round(m.percent) + "%</div>"; });
  var check = await JSZip.loadAsync(blob), n = 0;
  check.forEach(function(p, f){ if (!f.dir && /\.pdf$/i.test(p)) n++; });
  if (n !== ok.length) throw new Error("El ZIP tiene " + n + " PDF y se esperaban " + ok.length);
  $("dlMsg").innerHTML = '<div class="msg ok">ZIP verificado: ' + n + " PDF + registro de emisión.</div>";
  return blob;
}
$("zipByCo").addEventListener("click", async function(){ try { save(zipBase() + ".zip", await buildZip(true)); } catch(e){ msg("dlMsg","err", esc(e.message)); } });
$("zipFlat").addEventListener("click", async function(){ try { save(zipBase() + " (sin carpetas).zip", await buildZip(false)); } catch(e){ msg("dlMsg","err", esc(e.message)); } });
$("regBtn").addEventListener("click", function(){ save("Registro de Emisión - CLEAN SEA Academy.xlsx", registro(batch.results)); });
function refreshButtons(){
  var off = !downloads;
  ["zipByCo","zipFlat","regBtn","tplBtn"].forEach(function(id){ $(id).disabled = off; });
  if (off) $("tplBtn").title = "Descargas no disponibles en esta vista";
}

/* ═════════ 3 · VISTA PREVIA ═════════ */
var pv = { source: "mas", id: null, bytes: null, fname: "" };
function refreshPreviewList(render){
  var sel = $("pvSel"), list = visibleRows();
  if (!rows.length){ sel.innerHTML = '<option value="">Sin participantes cargados</option>'; $("pvPrev").disabled = $("pvNext").disabled = true;
    if (render){ var c = course(); C.generate({ name: "", title: c.title, date: c.date, preview: true }).then(function(r){ return renderPdf($("pCanvas"), r.bytes); }).catch(function(){}); $("pCap").textContent = "Cargá participantes en la pestaña Masivo para revisar cada certificado."; $("pNotes").innerHTML = ""; }
    return; }
  if (!list.some(function(r){ return r.id === pv.id; })) list = rows;
  if (pv.id == null || !rows.some(function(r){ return r.id === pv.id; })) pv.id = list[0].id;
  sel.innerHTML = list.map(function(r){ return '<option value="' + r.id + '"' + (r.id === pv.id ? " selected" : "") + ">" + r.n + " · " + esc(r.name || "(sin nombre)") + " — " + esc(r.company || "(sin empresa)") + "</option>"; }).join("");
  if (render) renderPreview();
}
function pvMove(d){
  var list = Array.from($("pvSel").options).map(function(o){ return +o.value; }), i = list.indexOf(pv.id);
  if (i < 0) return; i = Math.max(0, Math.min(list.length - 1, i + d)); pv.id = list[i]; $("pvSel").value = String(pv.id); renderPreview();
}
$("pvPrev").addEventListener("click", function(){ pvMove(-1); });
$("pvNext").addEventListener("click", function(){ pvMove(1); });
$("pvSel").addEventListener("change", function(e){ pv.id = +e.target.value; renderPreview(); });
async function renderPreview(){
  var r = rows.find(function(x){ return x.id === pv.id; }); if (!r) return;
  var c = course(), list = Array.from($("pvSel").options), i = list.findIndex(function(o){ return +o.value === pv.id; });
  $("pvPrev").disabled = i <= 0; $("pvNext").disabled = i >= list.length - 1;
  try {
    var g = await C.generate({ name: r.name, title: c.title, date: c.date, preview: true });
    pv.bytes = g.bytes; pv.fname = C.fileName(r.company, r.name, courseShort());
    await renderPdf($("pCanvas"), g.bytes);
    $("pNotes").innerHTML = notesHtml(g.info) + (r.status ? statusHtml(r.status) : "") + (!c.title || !c.date ? '<span class="pill err">Faltan título o fecha del curso</span>' : "");
    $("pCap").innerHTML = "<b>Archivo:</b> " + esc(pv.fname) + " · registro " + r.n + " de " + rows.length;
  } catch(e){ $("pNotes").innerHTML = '<span class="pill err">' + esc(e.message) + "</span>"; pv.bytes = null; }
}
var pvT;
function schedulePreview(){ clearTimeout(pvT); pvT = setTimeout(function(){ if (!$("p-pre").hidden) renderPreview(); }, 400); }

/* ═════════ 5 · REGISTRO · base de datos de emisiones ═════════ */
var DB = null, USER = null, myId = null, canEditDb = false, dbState = "loading", dbErr = "";
var recs = [];          // documentos de la colección "emisiones"
var emittedIdx = {};    // nombre|curso|fecha -> código de lote (para avisar re-emisiones)
var names = {};         // id -> nombre visible (se resuelve en cada render, no se guarda)
var CHUNK = 300;
var APP_VERSION = "1.4";   // versión del generador; se guarda en cada registro
var SCHEMA = 1;            // formato de los documentos de "emisiones": sólo se agregan campos, nunca se quitan ni renombran        // certificados por documento (límite de 256 KiB por documento)
function newCode(){
  var d = new Date(), z = function(n){ return String(n).padStart(2,"0"); };
  var r = Math.random().toString(36).slice(2, 6).toUpperCase();
  return "CSA-" + d.getFullYear() + z(d.getMonth()+1) + z(d.getDate()) + "-" + z(d.getHours()) + z(d.getMinutes()) + z(d.getSeconds()) + "-" + r;
}
function histKey(name){ var c = course(); if (!name || !c.title || !c.date) return ""; return normKey(name) + "|" + normKey(c.title) + "|" + c.date; }
function renderDbState(){
  var dot = $("dbDot"), t = $("dbText"), rs = $("regState");
  var map = { loading: ["wait","Conectando base de datos…"], slow: ["wait","La base de datos todavía no responde"], ok: ["on","Registro guardándose en la base"], off: ["off","Base de datos no disponible"], error: ["off","Base de datos no disponible (" + dbErr + ")"] };
  var m = map[dbState] || map.off; dot.className = "dot " + m[0]; t.textContent = m[1];
  if (rs) rs.textContent = dbState === "ok" ? "Sincronizado con la base de Integra. Se actualiza cada minuto y al volver a esta pestaña." : m[1];
}
myId = me.id; canEditDb = true; DB = sb;
async function recargarEmisiones(){
  var r = await sb.from("academy_emisiones").select("id, data, emisor_nombre").order("created_at").range(0, 9999);
  if (r.error){ dbState = "error"; dbErr = r.error.message; renderDbState(); renderReg(); return; }
  recs = r.data.map(function(x){ var d = Object.assign({}, x.data); d._id = x.id; d.emisorNombre = x.emisor_nombre || ""; return d; });
  dbState = "ok"; rebuildIdx(); renderDbState(); renderReg();
  if (rows.length) refresh();
}
recargarEmisiones();
setInterval(function(){ if (!document.hidden) recargarEmisiones(); }, 60000);
window.addEventListener("focus", recargarEmisiones);
function rebuildIdx(){
  emittedIdx = {};
  recs.forEach(function(r){ (r.certificados || []).forEach(function(c){ if (c.estado === "Generado") emittedIdx[normKey(c.nombre) + "|" + normKey(r.curso) + "|" + r.fechaCurso] = r.lote; }); });
}
async function saveRecord(code, tipo, crs, items){
    var certs = items.map(function(x){ return { n: x.n, empresa: x.company, nombre: x.name, archivo: x.bytes ? x.fname : "", carpeta: x.folder || "", estado: x.bytes ? "Generado" : (x.status || "No generado"), emitido: x.bytes ? x.emitted : "" }; });
  var parts = Math.max(1, Math.ceil(certs.length / CHUNK)), when = new Date().toISOString();
  for (var p = 0; p < parts; p++){
    var body = { v: SCHEMA, appVersion: APP_VERSION, lote: code, parte: p + 1, partes: parts, tipo: tipo, curso: crs.title, cursoCorto: crs.short || "", fechaCurso: crs.date, fechaCursoIso: crs.iso || "",
      creado: when, emisorId: myId || null, total: certs.length, generados: certs.filter(function(c){ return c.estado === "Generado"; }).length,
      certificados: certs.slice(p * CHUNK, (p + 1) * CHUNK) };
    var id = parts > 1 ? code + "-p" + (p + 1) : code, err = null;
    if (crs.cursoId) body.cursoId = crs.cursoId;
    var up = await sb.from("academy_emisiones").upsert({ id: id, data: body, curso_id: crs.cursoId || null, emisor_nombre: me.nombre || me.email });
    if (up.error) return { ok: false, msg: "no se pudo guardar en la base (" + up.error.message + ")." };
  }
  recargarEmisiones();
  return { ok: true };
}
function lotesView(){
  var by = {};
  recs.forEach(function(r){ var k = r.lote || r._id; var L = by[k] || (by[k] = { lote: k, tipo: r.tipo, curso: r.curso, cursoCorto: r.cursoCorto, fechaCurso: r.fechaCurso, fechaCursoIso: r.fechaCursoIso, creado: r.creado, emisorId: r.emisorId, emisorNombre: r.emisorNombre, total: r.total, ids: [], certs: [] });
    L.ids.push(r._id); L.certs = L.certs.concat(r.certificados || []); });
  return Object.keys(by).map(function(k){ var L = by[k]; L.certs.sort(function(a,b){ return a.n - b.n; }); return L; }).sort(function(a,b){ return (b.creado || "").localeCompare(a.creado || ""); });
}
function fmtTs(iso){ if (!iso) return ""; var d = new Date(iso), z = function(n){ return String(n).padStart(2,"0"); }; return z(d.getDate()) + "/" + z(d.getMonth()+1) + "/" + d.getFullYear() + " " + z(d.getHours()) + ":" + z(d.getMinutes()); }
function yearOf(L){ return (L.fechaCurso || "").slice(-4) || (L.creado || "").slice(0,4); }
function regFiltered(){
  var q = normKey($("rq").value), cu = $("rCurso").value, em = $("rEmpF").value, an = $("rAnio").value;
  var Ls = lotesView().filter(function(L){ return (!cu || (L.curso + " · " + L.fechaCurso) === cu) && (!an || yearOf(L) === an); });
  var rowsOut = [];
  Ls.forEach(function(L){ L.certs.forEach(function(c){
    if (em && c.empresa.toUpperCase() !== em) return;
    if (q && normKey(c.nombre + " " + c.empresa + " " + L.curso + " " + L.lote).indexOf(q) < 0) return;
    rowsOut.push({ L: L, c: c }); }); });
  var lotesOut = Ls.filter(function(L){ return rowsOut.some(function(x){ return x.L === L; }) || (!q && !em); });
  return { rows: rowsOut, lotes: lotesOut, all: Ls };
}
function who(L){ return (L && L.emisorNombre) || "—"; }
function fillSelect(id, values, label){
  var el = $(id), cur = el.value;
  el.innerHTML = '<option value="">' + label + "</option>" + values.map(function(v){ return '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + ">" + esc(v) + "</option>"; }).join("");
}
function renderReg(){
  var all = lotesView(), certs = [];
  all.forEach(function(L){ L.certs.forEach(function(c){ if (c.estado === "Generado") certs.push(c); }); });
  $("tabReg").textContent = certs.length;
  $("rCert").textContent = certs.length; $("rLotes").textContent = all.length;
  $("rCursos").textContent = new Set(all.map(function(L){ return normKey(L.curso) + L.fechaCurso; })).size;
  $("rEmp").textContent = new Set(certs.map(function(c){ return c.empresa.toUpperCase(); })).size;
  fillSelect("rCurso", Array.from(new Set(all.map(function(L){ return L.curso + " · " + L.fechaCurso; }))), "Todos los cursos");
  fillSelect("rEmpF", Array.from(new Set(certs.map(function(c){ return c.empresa.toUpperCase(); }))).sort(), "Todas las empresas");
  fillSelect("rAnio", Array.from(new Set(all.map(yearOf))).sort().reverse(), "Todos los años");
  renderDbState();
  $("rVer").textContent = "Generador v" + APP_VERSION + " · formato de registro " + SCHEMA;
  $("rRestoreWrap").hidden = !(DB && canEditDb && dbState === "ok");
  $("rBackup").disabled = !(dbState === "ok" && recs.length && downloads);
  var box = $("rBox");
  if (dbState === "off" || dbState === "error"){ box.innerHTML = '<div class="empty"><h3>No se pudo leer el registro</h3><p style="margin:0">' + esc(dbErr) + '. Los certificados se pueden generar igual, pero guardá el registro Excel de cada lote.</p></div>'; return; }
  if (dbState === "loading"){ box.innerHTML = '<div class="empty">Cargando el registro…</div>'; return; }
  if (!all.length){ box.innerHTML = '<div class="empty"><h3>Todavía no hay emisiones registradas</h3><p style="margin:0">Cuando generes un lote o un certificado individual, va a aparecer acá automáticamente.</p></div>'; return; }
  var f = regFiltered(), view = $("rVista").value;
  if (view === "lote"){
    box.innerHTML = '<table><thead><tr><th>Código</th><th>Tipo</th><th>Curso</th><th>Fecha curso</th><th>Certificados</th><th>Emitido</th><th>Por</th><th>Acciones</th></tr></thead><tbody>' +
      f.lotes.map(function(L){ var ok = L.certs.filter(function(c){ return c.estado === "Generado"; }).length;
        return '<tr data-lote="' + esc(L.lote) + '"><td class="mono" style="font-size:11.5px">' + esc(L.lote) + "</td><td>" + (L.tipo === "individual" ? "Individual" : L.tipo === "qr" ? "Curso (mail)" : "Lote") + "</td><td>" + esc(L.curso) + '</td><td class="mono">' + esc(L.fechaCurso) + '</td><td class="mono">' + ok + (ok !== L.certs.length ? ' <span class="pill err">' + (L.certs.length - ok) + " con error</span>" : "") + '</td><td class="mono" style="font-size:12px">' + esc(fmtTs(L.creado)) + "</td><td>" + esc(who(L)) + '</td><td class="act" style="width:auto"><button class="btn ghost" type="button" data-lx>Excel</button><button class="btn ghost" type="button" data-lz>ZIP</button><button class="btn ghost" type="button" data-ll>Cargar en Masivo</button>' + (canEditDb ? '<button class="btn ghost danger" type="button" data-ld>Eliminar</button>' : "") + "</td></tr>"; }).join("") + "</tbody></table>";
  } else {
    var MAX = 500, list = f.rows.slice(0, MAX);
    box.innerHTML = '<table><thead><tr><th>Emitido</th><th>Curso</th><th>Fecha curso</th><th>Empresa</th><th>Nombre y apellido</th><th>Estado</th><th>Lote</th><th>Acciones</th></tr></thead><tbody>' +
      list.map(function(x, i){ var c = x.c, L = x.L, ok = c.estado === "Generado";
        return '<tr data-i="' + i + '"><td class="mono" style="font-size:12px;white-space:nowrap">' + esc(fmtTs(L.creado)) + "</td><td>" + esc(L.curso) + '</td><td class="mono">' + esc(L.fechaCurso) + "</td><td>" + esc(c.empresa) + "</td><td>" + esc(c.nombre) + "</td><td>" + (ok ? '<span class="pill ok">Generado</span>' : '<span class="pill err">' + esc(c.estado) + "</span>") + '</td><td class="mono" style="font-size:11px">' + esc(L.lote) + '</td><td class="act">' + (ok ? '<button class="btn ghost" type="button" data-rg>Descargar PDF</button>' : "") + "</td></tr>"; }).join("") +
      "</tbody></table>" + (f.rows.length > MAX ? '<div class="empty" style="padding:12px">Mostrando ' + MAX + " de " + f.rows.length + ". Refiná la búsqueda o exportá a Excel.</div>" : "") + (!f.rows.length ? '<div class="empty">Ningún registro coincide con la búsqueda.</div>' : "");
    box._list = list;
  }
}
["rq","rCurso","rEmpF","rAnio","rVista"].forEach(function(id){ $(id).addEventListener("input", renderReg); });
function certsToItems(L){ return L.certs.map(function(c){ return { n: c.n, company: c.empresa, name: c.nombre, course: L.curso, date: L.fechaCurso, emitted: c.emitido || fmtTs(L.creado), fname: c.archivo, folder: c.carpeta, status: c.estado, bytes: c.estado === "Generado" ? true : null, lote: L.lote }; }); }
async function regenerate(L, c){
  var g = await C.generate({ name: c.nombre, title: L.curso, date: L.fechaCurso });
  await C.verify(g.bytes);
  return g.bytes;
}
$("rBox").addEventListener("click", async function(e){
  var tr = e.target.closest("tr"); if (!tr) return;
  if (e.target.closest("[data-rg]")){
    var x = $("rBox")._list[+tr.dataset.i];
    try { var b = await regenerate(x.L, x.c); save(x.c.archivo || C.fileName(x.c.empresa, x.c.nombre), blobPdf(b)); } catch(err){ msg("rMsg","err","No se pudo regenerar: " + esc(err.message)); }
    return;
  }
  var L = lotesView().find(function(l){ return l.lote === tr.dataset.lote; }); if (!L) return;
  if (e.target.closest("[data-lx]")) save("Registro de Emisión - " + L.lote + ".xlsx", registro(certsToItems(L)));
  if (e.target.closest("[data-lz]")){
    var ok = L.certs.filter(function(c){ return c.estado === "Generado"; }), zip = new JSZip(), i = 0;
    try {
      for (; i < ok.length; i++){ msg("rMsg","info","Regenerando " + (i + 1) + " de " + ok.length + "…"); var c = ok[i]; zip.file((c.carpeta ? c.carpeta + "/" : "") + (c.archivo || C.fileName(c.empresa, c.nombre)), await regenerate(L, c), { binary: true }); if (i % 3 === 2) await new Promise(function(r){ setTimeout(r, 0); }); }
      zip.file("Registro de Emisión - CLEAN SEA Academy.xlsx", registro(certsToItems(L)));
      var blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
      msg("rMsg","ok", ok.length + " certificados regenerados con la plantilla oficial.");
      save("CLEAN SEA ACADEMY - " + (L.cursoCorto || C.shortCourse(L.curso)) + " - " + L.fechaCurso.replace(/\//g, "-") + ".zip", blob);
    } catch(err){ msg("rMsg","err","No se pudo armar el ZIP: " + esc(err.message)); }
  }
  if (e.target.closest("[data-ll]")){
    if (rows.length){ var go = await modal("Reemplazar la lista de Masivo", "<p>La pestaña Masivo tiene " + rows.length + " participantes cargados. Se reemplazan por los " + L.certs.length + " del lote " + esc(L.lote) + ", con su curso y fecha.</p>", [{ label: "Cancelar", value: false }, { label: "Reemplazar", value: true, primary: true }]); if (!go) return; }
    $("mTitle").value = L.curso; $("mDate").value = L.fechaCursoIso || ""; $("mShort").value = L.cursoCorto || ""; updShortHint();
    rows = []; selected.clear(); seq = 0; L.certs.forEach(function(c){ rows.push(newRow(c.empresa, c.nombre)); });
    await refresh(); validateCourse(); showTab("mas");
    msg("impMsg","info","Cargados " + L.certs.length + " participantes del lote " + esc(L.lote) + ". Corregí lo necesario y volvé a generar: se registra como un lote nuevo.");
  }
  if (e.target.closest("[data-ld]")){
    var del = await modal("Eliminar " + L.lote, "<p>Se borra del registro el " + (L.tipo === "individual" ? "certificado individual" : "lote de " + L.certs.length + " certificados") + " de «" + esc(L.curso) + "». Los PDF ya descargados no se ven afectados. Esta acción no se puede deshacer.</p>", [{ label: "Cancelar", value: false }, { label: "Eliminar del registro", value: true, primary: true }]);
    if (!del) return;
    try { for (var k = 0; k < L.ids.length; k++){ var dr = await sb.from("academy_emisiones").delete().eq("id", L.ids[k]); if (dr.error) throw dr.error; } toast("Eliminado del registro: " + L.lote); recargarEmisiones(); }
    catch(err){ msg("rMsg","err","No se pudo eliminar (" + esc(err.code || err.message) + ")."); }
  }
});
$("rBackup").addEventListener("click", function(){
  var d = new Date(), z = function(n){ return String(n).padStart(2,"0"); };
  var out = { app: "CLEAN SEA Academy - Generador de Certificados", formato: SCHEMA, versionGenerador: APP_VERSION, exportado: d.toISOString(), coleccion: "emisiones",
    documentos: recs.map(function(r){ var x = Object.assign({}, r); var id = x._id; delete x._id; return { id: id, data: x }; }) };
  save("Respaldo Registro CLEAN SEA Academy - " + d.getFullYear() + "-" + z(d.getMonth()+1) + "-" + z(d.getDate()) + ".json", new Blob([JSON.stringify(out, null, 1)], { type: "application/json" }));
});
$("rRestore").addEventListener("change", async function(e){
  var f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    var j = JSON.parse(await f.text());
    if (!j || j.coleccion !== "emisiones" || !Array.isArray(j.documentos)) throw new Error("El archivo no es un respaldo del registro de CLEAN SEA Academy.");
    var have = new Set(recs.map(function(r){ return r._id; }));
    var nuevos = j.documentos.filter(function(d){ return d && d.id && d.data && !have.has(d.id) && /^[A-Za-z0-9_\-.~:@+]{1,200}$/.test(d.id) && Array.isArray(d.data.certificados); });
    var ok = await modal("Restaurar respaldo", "<p>El respaldo del " + esc(fmtTs(j.exportado)) + " tiene " + j.documentos.length + " registros. " + nuevos.length + " no están en la base y se van a agregar. Los que ya existen no se tocan.</p>",
      [{ label: "Cancelar", value: false }, { label: "Agregar " + nuevos.length + " registros", value: true, primary: true }]);
    if (!ok || !nuevos.length) return;
    for (var i = 0; i < nuevos.length; i++){ msg("rMsg","info","Restaurando " + (i + 1) + " de " + nuevos.length + "…"); var ur = await sb.from("academy_emisiones").upsert({ id: nuevos[i].id, data: nuevos[i].data, curso_id: nuevos[i].data.cursoId || null, emisor_nombre: nuevos[i].data.emisorNombre || null }); if (ur.error) throw ur.error; }
    recargarEmisiones();
    msg("rMsg","ok", nuevos.length + " registros restaurados.");
  } catch(err){ msg("rMsg","err", esc(err.message || err.code || "No se pudo restaurar.")); }
});
$("rExport").addEventListener("click", function(){
  var f = regFiltered();
  var aoa = [["Código de lote","Tipo","Curso","Fecha del curso","N.º","Empresa","Nombre y apellido","Archivo PDF","Estado","Fecha de emisión","Emitido por"]];
  f.rows.forEach(function(x){ aoa.push([x.L.lote, x.L.tipo === "individual" ? "Individual" : "Lote", x.L.curso, x.L.fechaCurso, x.c.n, x.c.empresa, x.c.nombre, x.c.archivo, x.c.estado, x.c.emitido || fmtTs(x.L.creado), who(x.L) === "—" ? "" : who(x.L)]); });
  var ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 26 }, { wch: 11 }, { wch: 46 }, { wch: 14 }, { wch: 6 }, { wch: 26 }, { wch: 34 }, { wch: 56 }, { wch: 14 }, { wch: 17 }, { wch: 24 }];
  ws["!autofilter"] = { ref: "A1:K" + aoa.length };
  var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Registro");
  var d = new Date(), z = function(n){ return String(n).padStart(2,"0"); };
  save("Base de Registros - CLEAN SEA Academy - " + z(d.getDate()) + "-" + z(d.getMonth()+1) + "-" + d.getFullYear() + ".xlsx", new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })]));
});

/* ═════════ 0 · CURSOS · inscripción por QR y envío de diplomas ═════════ */
var cur = { list: [], counts: {}, id: null, ins: [], sel: new Set(), canal: null, status: {} };
var PUBLIC_BASE = (import.meta.env.VITE_PUBLIC_URL || window.location.origin).replace(/\/$/, "");
function cursoLink(c){ return PUBLIC_BASE + "/i/" + c.token; }
function cursoSel(){ return cur.list.find(function(c){ return c.id === cur.id; }) || null; }

async function cargarCursos(){
  var r = await sb.from("academy_cursos").select("*").order("fecha", { ascending: false }).order("created_at", { ascending: false });
  if (r.error){ msg("cMsg", "err", "No se pudieron leer los cursos: " + esc(r.error.message)); return; }
  cur.list = r.data;
  var k = await sb.from("academy_inscripciones").select("curso_id");
  cur.counts = {};
  (k.data || []).forEach(function(x){ cur.counts[x.curso_id] = (cur.counts[x.curso_id] || 0) + 1; });
  renderCursos();
}
function renderCursos(){
  $("tabCur").textContent = cur.list.length;
  var box = $("cList");
  if (!cur.list.length){ box.innerHTML = '<div class="empty"><h3>Todavía no hay cursos</h3><p style="margin:0">Creá el curso antes de dictarlo: vas a obtener el QR para que los participantes se anoten.</p></div>'; }
  else box.innerHTML = '<table><thead><tr><th>Fecha</th><th>Curso</th><th>Inscriptos</th><th>Inscripción</th></tr></thead><tbody>' +
    cur.list.map(function(c){
      return '<tr data-c="' + c.id + '" class="' + (c.id === cur.id ? "sel" : "") + '" style="cursor:pointer"><td class="mono">' + esc(isoToAr(c.fecha)) + "</td><td>" + esc(c.titulo) + (c.lugar ? '<div class="muted" style="font-size:12px">' + esc(c.lugar) + "</div>" : "") +
        '</td><td class="mono">' + (cur.counts[c.id] || 0) + "</td><td>" + (c.abierto ? '<span class="pill ok">Abierta</span>' : '<span class="pill warn">Cerrada</span>') + "</td></tr>";
    }).join("") + "</tbody></table>";
  renderCursoDetalle();
}
$("cList").addEventListener("click", function(e){ var tr = e.target.closest("tr[data-c]"); if (tr) abrirCurso(tr.dataset.c); });

$("cForm").addEventListener("submit", async function(e){
  e.preventDefault();
  var t = C.clean($("cTitulo").value), f = $("cFecha").value;
  if (!t || !f){ msg("cMsg", "err", "Completá el título y la fecha del curso."); return; }
  var bad = C.unsupported(t);
  if (bad.length){ msg("cMsg", "err", "El título tiene caracteres que la tipografía del certificado no tiene: " + esc(bad.join(" "))); return; }
  var k = await C.check(null, t);
  if (!k.title.fits){ msg("cMsg", "err", "El título es demasiado extenso para el certificado: acortalo."); return; }
  var r = await sb.from("academy_cursos").insert({ titulo: t, fecha: f, lugar: C.clean($("cLugar").value) || null, instructor: C.clean($("cInstructor").value) || null }).select().single();
  if (r.error){ msg("cMsg", "err", "No se pudo crear el curso: " + esc(r.error.message)); return; }
  $("cForm").reset(); msg("cMsg", "ok", "Curso creado. Proyectá el QR al empezar la clase.");
  await cargarCursos(); abrirCurso(r.data.id);
});

async function abrirCurso(id){
  cur.id = id; cur.sel.clear(); cur.ins = []; cur.status = {};
  if (cur.canal){ sb.removeChannel(cur.canal); cur.canal = null; }
  renderCursos();
  await cargarInscriptos();
  cur.canal = sb.channel("academy-ins-" + id)
    .on("postgres_changes", { event: "*", schema: "public", table: "academy_inscripciones", filter: "curso_id=eq." + id }, function(){ cargarInscriptos(); })
    .subscribe();
}
async function cargarInscriptos(){
  if (!cur.id) return;
  var r = await sb.from("academy_inscripciones").select("*").eq("curso_id", cur.id).order("created_at");
  if (r.error){ msg("cdMsg", "err", "No se pudieron leer los inscriptos: " + esc(r.error.message)); return; }
  cur.ins = r.data; cur.counts[cur.id] = r.data.length;
  await validarInscriptos();
  renderCursoDetalle();
  var tr = document.querySelector('#cList tr[data-c="' + cur.id + '"] td:nth-child(3)'); if (tr) tr.textContent = r.data.length;
}
async function validarInscriptos(){
  var groups = {};
  cur.ins.forEach(function(x){ var k = normKey(x.nombre); (groups[k] = groups[k] || []).push(x); });
  for (var i = 0; i < cur.ins.length; i++){
    var x = cur.ins[i], errs = [], warns = [];
    var bad = C.unsupported(x.nombre);
    if (bad.length) errs.push("Caracteres no admitidos: " + bad.join(" "));
    else { var k = await C.check(x.nombre, null); if (!k.name.fits) errs.push("Nombre demasiado largo"); else if (k.name.lines > 1) warns.push("Nombre en 2 líneas"); }
    if (x.nombre.split(" ").length < 2) warns.push("Sólo una palabra");
    cur.status[x.id] = { errs: errs, warns: warns, dup: groups[normKey(x.nombre)].length > 1 };
  }
}
function fmtFH(iso){ return iso ? fmtTs(iso) : ""; }
function renderCursoDetalle(){
  var c = cursoSel(), box = $("cDet");
  box.hidden = !c; if (!c) return;
  $("cdTitulo").textContent = c.titulo;
  $("cdMeta").textContent = isoToAr(c.fecha) + (c.lugar ? " · " + c.lugar : "") + (c.instructor ? " · Instructor: " + c.instructor : "");
  $("cdLink").textContent = cursoLink(c); $("cdLink").href = cursoLink(c);
  $("cdAbrir").textContent = c.abierto ? "Cerrar inscripción" : "Reabrir inscripción";
  $("cdEstado").innerHTML = c.abierto ? '<span class="pill ok">Inscripción abierta</span>' : '<span class="pill warn">Inscripción cerrada: el QR ya no acepta inscriptos</span>';
  QRCode.toCanvas($("cdQr"), cursoLink(c), { width: 220, margin: 1, color: { dark: "#1B3765" } }, function(){});
  var env = cur.ins.filter(function(x){ return x.diploma_enviado_at; }).length;
  var err = cur.ins.filter(function(x){ return cur.status[x.id] && cur.status[x.id].errs.length; }).length;
  $("ckTotal").textContent = cur.ins.length; $("ckEnv").textContent = env; $("ckPend").textContent = cur.ins.length - env; $("ckErr").textContent = err; $("ckSel").textContent = cur.sel.size;
  var tb = $("cdBody");
  if (!cur.ins.length){ tb.innerHTML = '<tr><td colspan="9" class="empty">Todavía no se anotó nadie. Los inscriptos aparecen acá en el momento.</td></tr>'; }
  else tb.innerHTML = cur.ins.map(function(x, i){
    var st = cur.status[x.id], pills = st ? statusHtml(st) : "";
    if (x.diploma_enviado_at) pills = '<span class="pill ok">Diploma enviado ' + esc(fmtFH(x.diploma_enviado_at)) + "</span>" + (st && st.errs.length ? pills : "");
    if (x.origen === "forms") pills += '<span class="pill" title="Importado de Microsoft Forms">Forms</span>';
    else if (x.origen === "manual") pills += '<span class="pill" title="Pegado desde Excel">Excel</span>';
    return '<tr data-i="' + x.id + '"' + (cur.sel.has(x.id) ? ' class="sel"' : "") + '><td class="chk"><input type="checkbox" data-csel' + (cur.sel.has(x.id) ? " checked" : "") + ' aria-label="Seleccionar ' + esc(x.nombre) + '"></td>' +
      '<td class="num">' + (i + 1) + "</td>" +
      '<td><input type="text" data-cf="nombre" value="' + esc(x.nombre) + '" aria-label="Nombre"></td>' +
      '<td><input type="email" data-cf="email" value="' + esc(x.email) + '" aria-label="Mail"></td>' +
      '<td><input type="text" data-cf="empresa" value="' + esc(x.empresa) + '" aria-label="Empresa"></td>' +
      '<td><input type="text" data-cf="area" value="' + esc(x.area || "") + '" aria-label="Área"></td>' +
      '<td style="font-size:12.5px;white-space:nowrap">' + esc(x.puesto || "") + "</td>" +
      '<td class="st">' + pills + "</td>" +
      '<td class="act"><button class="btn ghost" type="button" data-cver>Ver</button><button class="btn ghost" type="button" data-cenv>Enviar</button><button class="btn ghost danger" type="button" data-cdel>Quitar</button></td></tr>';
  }).join("");
  $("cdSelAll").checked = cur.ins.length > 0 && cur.ins.every(function(x){ return cur.sel.has(x.id); });
}

$("cdBody").addEventListener("change", async function(e){
  var tr = e.target.closest("tr[data-i]"); if (!tr) return;
  var x = cur.ins.find(function(y){ return y.id === tr.dataset.i; }); if (!x) return;
  if (e.target.matches("[data-csel]")){ if (e.target.checked) cur.sel.add(x.id); else cur.sel.delete(x.id); tr.classList.toggle("sel", e.target.checked); $("ckSel").textContent = cur.sel.size; return; }
  var f = e.target.dataset.cf; if (!f) return;
  var v = f === "email" ? e.target.value.trim().toLowerCase() : C.clean(e.target.value);
  if (!v){ e.target.value = x[f]; return; }
  var patch = {}; patch[f] = v; patch.updated_at = new Date().toISOString();
  var r = await sb.from("academy_inscripciones").update(patch).eq("id", x.id);
  if (r.error){ msg("cdMsg", "err", "No se pudo guardar: " + esc(r.error.message)); e.target.value = x[f]; return; }
  x[f] = v; await validarInscriptos(); renderCursoDetalle();
});
$("cdSelAll").addEventListener("change", function(e){ cur.ins.forEach(function(x){ if (e.target.checked) cur.sel.add(x.id); else cur.sel.delete(x.id); }); renderCursoDetalle(); });
$("cdBody").addEventListener("click", async function(e){
  var tr = e.target.closest("tr[data-i]"); if (!tr) return;
  var x = cur.ins.find(function(y){ return y.id === tr.dataset.i; }); if (!x) return;
  var c = cursoSel();
  if (e.target.closest("[data-cver]")){
    try { var g = await C.generate({ name: x.nombre, title: c.titulo, date: isoToAr(c.fecha), preview: true }); await renderPdf($("cdCanvas"), g.bytes); $("cdPrev").hidden = false; $("cdPrevCap").innerHTML = "<b>" + esc(x.nombre) + "</b> · " + esc(x.email) + " " + notesHtml(g.info); $("cdPrev").scrollIntoView({ block: "nearest" }); }
    catch(err){ msg("cdMsg", "err", esc(err.message)); }
  }
  if (e.target.closest("[data-cenv]")) enviarDiplomas([x]);
  if (e.target.closest("[data-cdel]")){
    var ok = await modal("Quitar inscripto", "<p>Se borra a <b>" + esc(x.nombre) + "</b> (" + esc(x.email) + ") de este curso. No se puede deshacer.</p>", [{ label: "Cancelar", value: false }, { label: "Quitar", value: true, primary: true }]);
    if (!ok) return;
    var r = await sb.from("academy_inscripciones").delete().eq("id", x.id);
    if (r.error) msg("cdMsg", "err", esc(r.error.message)); else { cur.sel.delete(x.id); cargarInscriptos(); }
  }
});

$("cdAbrir").addEventListener("click", async function(){
  var c = cursoSel(); if (!c) return;
  var r = await sb.from("academy_cursos").update({ abierto: !c.abierto }).eq("id", c.id);
  if (r.error){ msg("cdMsg", "err", esc(r.error.message)); return; }
  c.abierto = !c.abierto; renderCursos();
});
$("cdCopiar").addEventListener("click", async function(){
  var c = cursoSel(); if (!c) return;
  try { await navigator.clipboard.writeText(cursoLink(c)); toast("Link copiado"); } catch(e){ toast(cursoLink(c)); }
});
$("cdProyectar").addEventListener("click", function(){
  var c = cursoSel(); if (!c) return;
  $("qrTitulo").textContent = c.titulo; $("qrSub").textContent = isoToAr(c.fecha) + (c.lugar ? " · " + c.lugar : "");
  $("qrLink").textContent = cursoLink(c).replace(/^https?:\/\//, "");
  var size = Math.min(window.innerWidth * 0.8, window.innerHeight * 0.62, 720);
  QRCode.toCanvas($("qrBig"), cursoLink(c), { width: Math.round(size), margin: 1, color: { dark: "#1B3765" } }, function(){});
  $("qrFull").hidden = false;
  if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function(){});
});
function cerrarQr(){ $("qrFull").hidden = true; if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function(){}); }
$("qrCerrar").addEventListener("click", cerrarQr);
document.addEventListener("keydown", function(e){ if (e.key === "Escape" && !$("qrFull").hidden) cerrarQr(); });
$("cdQrPng").addEventListener("click", function(){
  var c = cursoSel(); if (!c) return;
  QRCode.toDataURL(cursoLink(c), { width: 1200, margin: 2, color: { dark: "#1B3765" } }).then(function(u){
    fetch(u).then(function(r){ return r.blob(); }).then(function(b){ save("QR - " + C.shortCourse(c.titulo, 50) + " - " + isoToAr(c.fecha).replace(/\//g, "-") + ".png", b); });
  });
});

$("cdMasivo").addEventListener("click", async function(){
  var c = cursoSel(); if (!c || !cur.ins.length) return;
  var set = cur.sel.size ? cur.ins.filter(function(x){ return cur.sel.has(x.id); }) : cur.ins;
  if (rows.length){ var go = await modal("Reemplazar la lista de Masivo", "<p>La pestaña Masivo tiene " + rows.length + " participantes. Se reemplazan por los " + set.length + " inscriptos de este curso.</p>", [{ label: "Cancelar", value: false }, { label: "Reemplazar", value: true, primary: true }]); if (!go) return; }
  $("mTitle").value = c.titulo; $("mDate").value = c.fecha; $("mShort").value = c.titulo_corto || ""; updShortHint();
  rows = []; selected.clear(); seq = 0; set.forEach(function(x){ rows.push(newRow(x.empresa, x.nombre)); });
  await refresh(); validateCourse(); showTab("mas");
  msg("impMsg", "info", "Cargados " + set.length + " inscriptos del curso. Desde acá podés generar el ZIP por empresa.");
});

/* ── Importar respuestas de Microsoft Forms ──
   El QR del instructor es siempre el mismo y lleva a un Forms; las respuestas de todos los cursos
   caen en una planilla maestra. Cada curso tiene una fecha única: se toman las respuestas de ese día. */
var PUESTOS = ["Director/Gerente","Jefe","Supervisor","Coordinador","Analista/Administrativo","Operador","Otro"];
function puestoDeTexto(t){
  var k = normKey(t || "");
  if (!k) return "Otro";
  var exacto = PUESTOS.find(function(p){ return normKey(p) === k; }); if (exacto) return exacto;
  if (/gerent|director|manager|gte\b/.test(k)) return "Director/Gerente";
  if (/\bjef|\bhead\b|chief/.test(k)) return "Jefe";
  if (/superv/.test(k)) return "Supervisor";
  if (/coordin/.test(k)) return "Coordinador";
  if (/analist|administr|office|staff|asistent|tecnic|ingenier|especialist|auxiliar/.test(k)) return "Analista/Administrativo";
  if (/operari|operador|operat|maquinist|marin|tripul|marinero|ayudante/.test(k)) return "Operador";
  return "Otro";
}
function fechaIso(v){
  if (v == null || v === "") return "";
  var z = function(n){ return String(n).padStart(2, "0"); };
  if (v instanceof Date && !isNaN(v)) return v.getFullYear() + "-" + z(v.getMonth() + 1) + "-" + z(v.getDate());
  if (typeof v === "number"){ var d = XLSX.SSF.parse_date_code(v); return d ? d.y + "-" + z(d.m) + "-" + z(d.d) : ""; }
  var s = String(v).trim(), m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1] + "-" + z(m[2]) + "-" + z(m[3]);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/))){
    var a = +m[1], b = +m[2], y = +m[3]; if (y < 100) y += 2000;
    var dia = a > 12 ? a : b > 12 ? b : a, mes = a > 12 ? b : b > 12 ? a : b; // ambiguo: se asume día/mes
    return y + "-" + z(mes) + "-" + z(dia);
  }
  return "";
}
function horaTs(v){
  if (v instanceof Date && !isNaN(v)) return v.toISOString();
  return null;
}
function columnasForms(hdr){
  var H = hdr.map(function(h){ return normKey(h); });
  var find = function(re, skip){ for (var i = 0; i < H.length; i++){ if ((!skip || skip.indexOf(i) < 0) && re.test(H[i])) return i; } return -1; };
  var col = {};
  col.fecha = find(/^hora de finalizacion|^completion time|^hora de envio|^marca temporal|^timestamp/);
  if (col.fecha < 0) col.fecha = find(/^hora de inicio|^start time|^fecha/);
  // Forms agrega "Correo electrónico" y "Nombre" de la cuenta (suelen decir "anonymous"): se prefieren las preguntas.
  var base = [find(/^correo electronico$|^email$/), find(/^nombre$|^name$/), find(/^id$/)].filter(function(i){ return i >= 0; });
  col.nombreCompleto = find(/(nombre.*apellido|apellido.*nombre|nombre completo|full name)/);
  col.apellido = col.nombreCompleto >= 0 ? -1 : find(/^apellidos?\b/);
  col.nombre = col.nombreCompleto >= 0 ? -1 : find(/^nombres?\b/, base);
  if (col.nombre < 0 && col.nombreCompleto < 0) col.nombre = find(/^nombres?$/);
  col.email = find(/(mail|correo)/, base);
  if (col.email < 0) col.email = find(/(mail|correo)/);
  col.empresa = find(/(empresa|compan|organiz|company)/);
  col.area = find(/(^area\b|\barea$|sector|departamento)/);
  col.puesto = find(/(puesto|cargo|position|rol\b)/);
  return col;
}
async function leerForms(file){
  var buf = new Uint8Array(await file.arrayBuffer()), wb;
  if (/\.csv$/i.test(file.name)){
    var text = new TextDecoder("utf-8").decode(buf); if (text.indexOf("�") >= 0) text = new TextDecoder("windows-1252").decode(buf);
    wb = XLSX.read(text.replace(/^﻿/, ""), { type: "string", cellDates: true });
  } else wb = XLSX.read(buf, { type: "array", cellDates: true });
  var ws = wb.Sheets[wb.SheetNames[0]];
  var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
  if (!aoa.length) throw new Error("La planilla está vacía.");
  var col = columnasForms(aoa[0]);
  if (col.fecha < 0) throw new Error("No encontré la columna de fecha de la respuesta (\"Hora de finalización\" o \"Hora de inicio\").");
  if (col.email < 0) throw new Error("No encontré la columna del mail.");
  if (col.nombre < 0 && col.nombreCompleto < 0) throw new Error("No encontré la columna del nombre.");
  var out = [];
  for (var r = 1; r < aoa.length; r++){
    var row = aoa[r], get = function(i){ return i >= 0 ? C.clean(row[i]) : ""; };
    var nombre = col.nombreCompleto >= 0 ? get(col.nombreCompleto) : C.clean(get(col.nombre) + " " + get(col.apellido));
    var email = get(col.email).toLowerCase();
    if (!nombre && !email) continue;
    out.push({ fila: r + 1, fecha: fechaIso(row[col.fecha]), hora: horaTs(row[col.fecha]), nombre: nombre, email: email,
      empresa: get(col.empresa), area: get(col.area), puestoTexto: get(col.puesto), puesto: puestoDeTexto(get(col.puesto)) });
  }
  return { filas: out, col: col, hoja: wb.SheetNames[0], encabezados: aoa[0] };
}
// "PEREZ JUAN" / "juan perez" → "Perez Juan" / "Juan Perez" (mismo criterio que el formulario del QR).
function nombrePropio(s){
  var MIN = ["de","del","la","las","los","y","da","das","do","dos","van","von","di"];
  return C.clean(s).split(" ").filter(Boolean).map(function(w, i){
    var mezclada = w !== w.toLowerCase() && w !== w.toUpperCase() && w.slice(1) !== w.slice(1).toLowerCase();
    if (mezclada) return w;
    var low = w.toLowerCase(); if (i > 0 && MIN.indexOf(low) >= 0) return low;
    return low.split("-").map(function(p){ return p.charAt(0).toUpperCase() + p.slice(1); }).join("-");
  }).join(" ");
}
$("cdForms").addEventListener("change", async function(e){
  var f = e.target.files[0]; e.target.value = ""; if (!f) return;
  var c = cursoSel(); if (!c) return;
  try {
    msg("cdMsg", "info", "Leyendo «" + esc(f.name) + "»…");
    var p = await leerForms(f);
    var delDia = p.filas.filter(function(x){ return x.fecha === c.fecha; });
    if (!delDia.length){
      var porFecha = {}; p.filas.forEach(function(x){ if (x.fecha) porFecha[x.fecha] = (porFecha[x.fecha] || 0) + 1; });
      var fechas = Object.keys(porFecha).sort().reverse().slice(0, 8).map(function(d){ return isoToAr(d) + " (" + porFecha[d] + ")"; });
      msg("cdMsg", "warn", "La planilla no tiene respuestas del " + esc(isoToAr(c.fecha)) + ", la fecha del curso." + (fechas.length ? " Fechas con respuestas: " + esc(fechas.join(", ")) + "." : ""));
      return;
    }
    await confirmarEImportar(c, delDia, { titulo: "Importar respuestas de Forms", origen: "forms", fuente: "«" + f.name + "»",
      intro: "La planilla tiene " + p.filas.length + " respuestas; <b>" + delDia.length + "</b> son de esta fecha.",
      sinColEmpresa: p.col.empresa < 0 ? "La planilla no tiene columna de empresa: quedan como «Sin empresa» y se pueden corregir en la tabla. Conviene agregar la pregunta Empresa al Forms." : "",
      sinColPuesto: p.col.puesto < 0 });
  } catch(err){ msg("cdMsg", "err", esc(err.message)); }
});

// Resumen + confirmación + alta (Forms y Pegar desde Excel). lista: [{fila, nombre, email, empresa, area, puesto, puestoTexto, hora?}]
async function confirmarEImportar(c, lista, o){
  var ya = new Set(cur.ins.map(function(x){ return x.email.toLowerCase(); })), vistos = new Set();
  var nuevos = [], repetidos = 0, invalidos = [];
  lista.forEach(function(x){
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.email) || x.nombre.length < 3){ invalidos.push("fila " + x.fila + (x.nombre ? " (" + x.nombre + ")" : "")); return; }
    if (ya.has(x.email) || vistos.has(x.email)){ repetidos++; return; }
    vistos.add(x.email); nuevos.push(x);
  });
  var sinEmpresa = nuevos.filter(function(x){ return !x.empresa; }).length;
  var vista = nuevos.length ? '<div class="tablebox" style="max-height:220px;margin:0 0 10px"><table style="min-width:0;font-size:12.5px"><thead><tr><th>Nombre y apellido</th><th>Mail</th><th>Empresa</th><th>Puesto</th></tr></thead><tbody>' +
    nuevos.map(function(x){ return "<tr><td>" + esc(nombrePropio(x.nombre)) + "</td><td>" + esc(x.email) + "</td><td>" + esc(x.empresa || "Sin empresa") + "</td><td>" + esc(x.puesto) +
      (x.puestoTexto && normKey(x.puestoTexto) !== normKey(x.puesto) ? ' <span class="muted">(' + esc(x.puestoTexto) + ")</span>" : "") + "</td></tr>"; }).join("") +
    "</tbody></table></div>" : "";
  var ok = await modal(o.titulo,
    "<p><b>Curso:</b> " + esc(c.titulo) + "<br><b>Fecha:</b> " + esc(isoToAr(c.fecha)) + "</p>" +
    "<p>" + o.intro + "</p>" +
    "<ul style=\"margin:0 0 8px;padding-left:18px\"><li><b>" + nuevos.length + "</b> se agregan como inscriptos</li>" +
    (repetidos ? "<li>" + repetidos + " ya estaban (mismo mail): no se tocan</li>" : "") +
    (invalidos.length ? "<li>" + invalidos.length + " sin mail o nombre válido: se omiten (" + esc(invalidos.slice(0, 5).join(", ")) + (invalidos.length > 5 ? "…" : "") + ")</li>" : "") + "</ul>" + vista +
    (o.sinColEmpresa ? '<div class="msg warn">' + o.sinColEmpresa + "</div>" :
      sinEmpresa ? '<div class="msg warn">' + sinEmpresa + " sin empresa: quedan como «Sin empresa».</div>" : "") +
    (o.sinColPuesto ? '<div class="msg warn">No hay columna de puesto: quedan como «Otro».</div>' : ""),
    [{ label: "Cancelar", value: false }, { label: "Importar " + nuevos.length, value: true, primary: true }]);
  if (!ok || !nuevos.length){ msg("cdMsg", "", ""); return; }
  var filas = nuevos.map(function(x){ return { curso_id: c.id, nombre: nombrePropio(x.nombre).slice(0, 120), email: x.email.slice(0, 200),
    empresa: (x.empresa || "Sin empresa").slice(0, 120), area: x.area ? x.area.slice(0, 120) : null, puesto: x.puesto, origen: o.origen, respondido_at: x.hora || null }; });
  var r = await sb.from("academy_inscripciones").insert(filas);
  if (r.error){ msg("cdMsg", "err", "No se pudo importar: " + esc(r.error.message)); return; }
  msg("cdMsg", "ok", nuevos.length + " inscriptos importados desde " + esc(o.fuente) + ". Revisá nombres y empresas antes de enviar los diplomas.");
  cargarInscriptos();
}

/* ── Pegar desde Excel: se copian las filas del curso (con la fila de títulos) y se pegan acá ── */
// Texto copiado de Excel = filas por salto de línea, celdas por tabulador; una celda con saltos viene entre comillas.
function parseTsv(t){
  var rows = [], row = [], cell = "", q = false;
  t = t.replace(/\r\n?/g, "\n");
  for (var i = 0; i < t.length; i++){
    var ch = t[i];
    if (q){ if (ch === '"'){ if (t[i + 1] === '"'){ cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"' && cell === "") q = true;
    else if (ch === "\t"){ row.push(cell); cell = ""; }
    else if (ch === "\n"){ row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length){ row.push(cell); rows.push(row); }
  return rows.filter(function(r){ return r.some(function(x){ return C.clean(x); }); });
}
// Sin fila de títulos se asume el orden de la planilla: Nombre y Apellido | Empresa | Cargo | Área | Mail.
function leerPegado(texto){
  var aoa = parseTsv(texto);
  if (!aoa.length) throw new Error("No hay nada pegado.");
  var col = columnasForms(aoa[0]);
  var conTitulos = col.email >= 0 && (col.nombre >= 0 || col.nombreCompleto >= 0) && !aoa[0].some(function(x){ return /@/.test(x); });
  if (!conTitulos){
    var mail = aoa[0].findIndex(function(x){ return /@/.test(x); });
    col = { nombreCompleto: 0, nombre: -1, apellido: -1, empresa: 1, puesto: 2, area: 3, email: mail >= 0 ? mail : 4 };
  }
  var filas = [];
  aoa.slice(conTitulos ? 1 : 0).forEach(function(row, k){
    var get = function(i){ return i >= 0 ? C.clean(row[i]) : ""; };
    var nombre = col.nombreCompleto >= 0 ? get(col.nombreCompleto) : C.clean(get(col.nombre) + " " + get(col.apellido));
    var email = get(col.email).toLowerCase();
    if (!nombre && !email) return;
    filas.push({ fila: k + 1, nombre: nombre, email: email, empresa: get(col.empresa), area: get(col.area), puestoTexto: get(col.puesto), puesto: puestoDeTexto(get(col.puesto)) });
  });
  return { filas: filas, col: col, conTitulos: conTitulos };
}
$("cdPegar").addEventListener("click", async function(){
  var c = cursoSel(); if (!c) return;
  var ok = await modal("Pegar desde Excel",
    "<p>En la planilla seleccioná las filas de este curso <b>junto con la fila de títulos</b> (Nombre y Apellido, Empresa, Cargo, Área, Mail), copiá con Ctrl+C y pegá acá con Ctrl+V.</p>" +
    '<textarea id="pgTxt" rows="8" style="width:100%;font:12px ui-monospace,Consolas,monospace;white-space:pre;resize:vertical" placeholder="Pegá acá (Ctrl+V)" aria-label="Filas copiadas de Excel"></textarea>',
    [{ label: "Cancelar", value: false }, { label: "Revisar", value: true, primary: true }]);
  var texto = $("pgTxt") ? $("pgTxt").value : "";
  if (!ok) return;
  try {
    var p = leerPegado(texto);
    if (!p.filas.length){ msg("cdMsg", "warn", "No encontré personas en lo que pegaste."); return; }
    await confirmarEImportar(c, p.filas, { titulo: "Pegar desde Excel", origen: "manual", fuente: "Excel",
      intro: "Pegaste <b>" + p.filas.length + "</b> " + (p.filas.length === 1 ? "persona" : "personas") + (p.conTitulos ? "." : ". No vino la fila de títulos: usé el orden Nombre y Apellido, Empresa, Cargo, Área, Mail."),
      sinColEmpresa: p.col.empresa < 0 ? "No vino la columna Empresa: quedan como «Sin empresa»." : "", sinColPuesto: p.col.puesto < 0 });
  } catch(err){ msg("cdMsg", "err", esc(err.message)); }
});

$("cdExcel").addEventListener("click", function(){
  var c = cursoSel(); if (!c) return;
  var aoa = [["N.º","Nombre y apellido","Mail","Empresa","Área","Tipo de puesto","Origen","Inscripto","Diploma enviado"]];
  cur.ins.forEach(function(x, i){ aoa.push([i + 1, x.nombre, x.email, x.empresa, x.area || "", x.puesto || "", x.origen === "forms" ? "Forms" : x.origen === "manual" ? "Excel" : "QR", fmtFH(x.respondido_at || x.created_at), fmtFH(x.diploma_enviado_at)]); });
  var ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 6 }, { wch: 32 }, { wch: 32 }, { wch: 24 }, { wch: 30 }, { wch: 22 }, { wch: 8 }, { wch: 17 }, { wch: 17 }];
  ws["!autofilter"] = { ref: "A1:I" + aoa.length };
  var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Inscriptos");
  save("Inscriptos - " + C.shortCourse(c.titulo, 50) + " - " + isoToAr(c.fecha).replace(/\//g, "-") + ".xlsx", new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })]));
});

$("cdBorrar").addEventListener("click", async function(){
  var c = cursoSel(); if (!c) return;
  var ok = await modal("Eliminar curso", "<p>Se borra «" + esc(c.titulo) + "» con sus " + cur.ins.length + " inscriptos. Los diplomas ya registrados quedan en el Registro. No se puede deshacer.</p>", [{ label: "Cancelar", value: false }, { label: "Eliminar curso", value: true, primary: true }]);
  if (!ok) return;
  var r = await sb.from("academy_cursos").delete().eq("id", c.id);
  if (r.error){ msg("cdMsg", "err", esc(r.error.message)); return; }
  if (cur.canal){ sb.removeChannel(cur.canal); cur.canal = null; }
  cur.id = null; cargarCursos();
});

function bytesToB64(bytes){
  var s = "", CH = 0x8000;
  for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}
$("cdEnviar").addEventListener("click", function(){
  var set = cur.sel.size ? cur.ins.filter(function(x){ return cur.sel.has(x.id); }) : cur.ins.filter(function(x){ return !x.diploma_enviado_at; });
  if (!set.length){ msg("cdMsg", "info", cur.ins.length ? "Todos los inscriptos ya recibieron su diploma. Para reenviar, seleccioná a quién." : "No hay inscriptos."); return; }
  enviarDiplomas(set);
});
async function enviarDiplomas(set){
  var c = cursoSel(); if (!c) return;
  var bad = set.filter(function(x){ return cur.status[x.id] && cur.status[x.id].errs.length; });
  if (bad.length){ msg("cdMsg", "err", bad.length + " inscriptos tienen errores en el nombre (" + esc(bad.map(function(x){ return x.nombre; }).join(", ")) + "). Corregilos en la tabla antes de enviar."); return; }
  var re = set.filter(function(x){ return x.diploma_enviado_at; }).length;
  var ok = await modal("Enviar " + set.length + (set.length === 1 ? " diploma" : " diplomas") + " por mail",
    "<p><b>Curso:</b> " + esc(c.titulo) + "<br><b>Fecha:</b> " + esc(isoToAr(c.fecha)) + "</p><p>Cada participante recibe su certificado en PDF en el email con que se inscribió." +
    (set.length <= 5 ? "<br>" + set.map(function(x){ return esc(x.nombre) + " — " + esc(x.email); }).join("<br>") : "") + "</p>" +
    (re ? '<div class="msg warn">' + re + " ya lo recibieron antes: se les vuelve a enviar.</div>" : ""),
    [{ label: "Cancelar", value: false }, { label: "Enviar", value: true, primary: true }]);
  if (!ok) return;
  var btn = $("cdEnviar"); btn.disabled = true;
  var code = newCode(), used = new Set(), items = [], okN = 0, fallas = [];
  var title = c.titulo, date = isoToAr(c.fecha);
  for (var i = 0; i < set.length; i++){
    var x = set[i];
    msg("cdMsg", "info", "Enviando " + (i + 1) + " de " + set.length + " · " + esc(x.nombre) + "…");
    var folder = C.cut(C.fsSafe(x.empresa), 40).toUpperCase() || "SIN EMPRESA";
    var fname = C.uniqueName(used, folder, C.fileName(x.empresa, x.nombre, C.shortCourse(title)));
    var item = { n: i + 1, company: x.empresa, name: x.nombre, folder: folder, fname: fname, bytes: null, status: "", emitted: "" };
    try {
      var g = await C.generate({ name: x.nombre, title: title, date: date });
      await C.verify(g.bytes);
      var r = await sb.functions.invoke("academy-enviar-diploma", { body: { inscripcion_id: x.id, filename: fname, pdf_base64: bytesToB64(g.bytes), lote: code } });
      if (r.error){
        var det = ""; try { det = (await r.error.context.json()).error || ""; } catch(e2){}
        throw new Error(det || r.error.message);
      }
      item.bytes = true; item.status = "Generado"; item.emitted = nowAr(); okN++;
    } catch(err){ item.status = "Error: " + err.message; fallas.push(x.nombre + ": " + err.message); }
    items.push(item);
    if (fallas.length && /no está configurado/i.test(fallas[0])) break;
  }
  btn.disabled = false;
  if (okN){
    var sr = await saveRecord(code, "qr", { title: title, date: date, iso: c.fecha, short: c.titulo_corto || C.shortCourse(title), cursoId: c.id }, items.filter(function(x){ return x.bytes; }));
    if (!sr.ok) fallas.push("Registro: " + sr.msg);
  }
  msg("cdMsg", fallas.length ? (okN ? "warn" : "err") : "ok",
    (okN ? okN + (okN === 1 ? " diploma enviado" : " diplomas enviados") + " (registro " + esc(code) + ")." : "No se envió ningún diploma.") +
    (fallas.length ? "<br>" + fallas.map(esc).join("<br>") : ""));
  cargarInscriptos();
}

cargarCursos();

/* ── Inicio ── */
updShortHint(); refresh(); indPreview(); showTab("cur");
}
