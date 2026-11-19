import { supabase as sb } from "./lib/supabase.js";

const $ = (id) => document.getElementById(id);
const show = (id) => ["cargando", "noCurso", "cerrado", "formCard", "listo"].forEach((x) => { $(x).hidden = x !== id; });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fechaAr = (iso) => (iso ? iso.split("-").reverse().join("/") : "");

const token = (location.pathname.match(/\/i\/([A-Za-z0-9-]+)/) || [])[1] || new URLSearchParams(location.search).get("c") || "";
const GUARDADO = "csa-mis-datos";

// "juan PEREZ de la fuente" → "Juan Perez de la Fuente". Las palabras que ya mezclan mayúsculas
// y minúsculas (McDonald, DiStefano) se respetan tal como las escribió la persona.
const MINUS = new Set(["de", "del", "la", "las", "los", "y", "da", "das", "do", "dos", "van", "von", "di"]);
const cap = (p) => p.charAt(0).toUpperCase() + p.slice(1);
function nombrePropio(s) {
  return s.replace(/\s+/g, " ").trim().split(" ").filter(Boolean).map((w, i) => {
    const mezclada = w !== w.toLowerCase() && w !== w.toUpperCase() && w.slice(1) !== w.slice(1).toLowerCase();
    if (mezclada) return w;
    const low = w.toLowerCase();
    if (i > 0 && MINUS.has(low)) return low;
    return low.split("-").map(cap).join("-");
  }).join(" ");
}

async function iniciar() {
  if (!token) { show("noCurso"); return; }
  const { data, error } = await sb.rpc("academy_curso_publico", { p_token: token });
  const c = data && data[0];
  if (error || !c) { show("noCurso"); return; }
  document.querySelectorAll(".ctitulo").forEach((el) => { el.textContent = c.titulo; });
  document.querySelectorAll(".cmeta").forEach((el) => { el.textContent = fechaAr(c.fecha) + (c.lugar ? " · " + c.lugar : ""); });
  document.title = c.titulo + " · CLEAN SEA Academy";
  if (!c.abierto) { show("cerrado"); return; }
  try {
    const d = JSON.parse(localStorage.getItem(GUARDADO) || "null");
    if (d) {
      $("fNombre").value = d.nombre || ""; $("fDni").value = d.dni || ""; $("fEmpresa").value = d.empresa || "";
      $("fCargo").value = d.cargo || ""; $("fEmail").value = d.email || ""; $("fTel").value = d.telefono || "";
    }
  } catch { /* sin almacenamiento local */ }
  vistaNombre();
  show("formCard");
}

function vistaNombre() {
  const n = nombrePropio($("fNombre").value);
  $("fNombreVista").textContent = n ? "En el certificado: " + n : "";
}
$("fNombre").addEventListener("input", vistaNombre);

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = {
    nombre: nombrePropio($("fNombre").value), dni: $("fDni").value.trim(), empresa: $("fEmpresa").value.replace(/\s+/g, " ").trim(),
    cargo: $("fCargo").value.replace(/\s+/g, " ").trim(), email: $("fEmail").value.trim().toLowerCase(), telefono: $("fTel").value.trim(),
  };
  const faltan = [];
  const marcar = (id, mal) => { $(id).setAttribute("aria-invalid", mal ? "true" : "false"); return mal; };
  if (marcar("fNombre", v.nombre.length < 3 || v.nombre.split(" ").length < 2)) faltan.push("nombre y apellido");
  if (marcar("fDni", !/^[A-Za-z0-9]{5,20}$/.test(v.dni.replace(/[^A-Za-z0-9]/g, "")))) faltan.push("DNI o pasaporte");
  if (marcar("fEmpresa", !v.empresa)) faltan.push("empresa");
  if (marcar("fCargo", !v.cargo)) faltan.push("cargo");
  if (marcar("fEmail", !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email))) faltan.push("email");
  if (marcar("fTel", !/^[0-9+()\-\s.]{6,40}$/.test(v.telefono))) faltan.push("teléfono");
  if (faltan.length) { $("fMsg").innerHTML = `<div class="msg err">Revisá: ${faltan.join(", ")}.</div>`; return; }

  $("fBtn").disabled = true; $("fMsg").innerHTML = "";
  const { data, error } = await sb.rpc("academy_inscribir", {
    p_token: token, p_nombre: v.nombre, p_empresa: v.empresa, p_dni: v.dni, p_email: v.email, p_telefono: v.telefono, p_cargo: v.cargo,
  });
  $("fBtn").disabled = false;
  if (error) {
    const txt = error.code === "P0001" ? error.message : "No se pudo registrar. Revisá la conexión y probá de nuevo.";
    $("fMsg").innerHTML = `<div class="msg err">${esc(txt)}</div>`;
    return;
  }
  try { localStorage.setItem(GUARDADO, JSON.stringify(v)); } catch { /* sin almacenamiento local */ }
  $("lTitulo").textContent = data === "actualizado" ? "¡Datos actualizados!" : "¡Asistencia registrada!";
  $("lTexto").innerHTML = `Gracias, <b>${esc(v.nombre.split(" ")[0])}</b>. Al finalizar el curso te vamos a enviar el certificado a <b>${esc(v.email)}</b>.`;
  show("listo");
});

iniciar();
