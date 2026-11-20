// Formulario público del QR fijo (/registro). Mismo cuestionario que el Microsoft Forms "Registro de Asistencia".
// Cada envío va a la base maestra de personas; desde la app se elige a quién darle el diploma de cada curso.
import { supabase as sb } from "./lib/supabase.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fechaAr = (iso) => (iso ? iso.split("-").reverse().join("/") : "");
const limpio = (s) => s.replace(/\s+/g, " ").trim();
const GUARDADO = "csa-mis-datos";

// "juan PEREZ de la fuente" → "Juan Perez de la Fuente". Las palabras que ya mezclan mayúsculas
// y minúsculas (McDonald, DiStefano) se respetan tal como las escribió la persona.
const MINUS = new Set(["de", "del", "la", "las", "los", "y", "da", "das", "do", "dos", "van", "von", "di"]);
const cap = (p) => p.charAt(0).toUpperCase() + p.slice(1);
function nombrePropio(s) {
  return limpio(s).split(" ").filter(Boolean).map((w, i) => {
    const mezclada = w !== w.toLowerCase() && w !== w.toUpperCase() && w.slice(1) !== w.slice(1).toLowerCase();
    if (mezclada) return w;
    const low = w.toLowerCase();
    if (i > 0 && MINUS.has(low)) return low;
    return low.split("-").map(cap).join("-");
  }).join(" ");
}
function hoyAr() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).slice(0, 10);
}

$("fFecha").value = hoyAr();
$("fFecha").max = hoyAr();
try {
  const d = JSON.parse(localStorage.getItem(GUARDADO) || "null");
  if (d) {
    $("fNombre").value = d.nombre || ""; $("fEmail").value = d.email || ""; $("fEmpresa").value = d.empresa || "";
    $("fCargo").value = d.cargo || ""; $("fArea").value = d.area || "";
  }
} catch { /* sin almacenamiento local */ }

function vistaNombre() {
  const n = nombrePropio($("fNombre").value);
  $("fNombreVista").textContent = n ? "En el certificado: " + n : "";
}
$("fNombre").addEventListener("input", vistaNombre);
vistaNombre();

// Estrellas: se pintan hasta la elegida.
const estrellas = [...document.querySelectorAll(".stars-row label")];
const elegida = () => { const c = document.querySelector('input[name="calif"]:checked'); return c ? +c.value : 0; };
function pintar(n) { estrellas.forEach((l, i) => l.classList.toggle("on", i < n)); }
document.querySelectorAll('input[name="calif"]').forEach((r) => r.addEventListener("change", () => { pintar(+r.value); $("fCalif").setAttribute("aria-invalid", "false"); }));
estrellas.forEach((l, i) => {
  l.addEventListener("mouseenter", () => pintar(i + 1));
  l.addEventListener("mouseleave", () => pintar(elegida()));
});

$("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = {
    fecha: $("fFecha").value, nombre: nombrePropio($("fNombre").value), empresa: limpio($("fEmpresa").value),
    cargo: limpio($("fCargo").value), area: limpio($("fArea").value), email: $("fEmail").value.trim().toLowerCase(),
    calificacion: elegida() || null, observaciones: $("fObs").value.trim(),
  };
  const faltan = [];
  const marcar = (id, mal) => { $(id).setAttribute("aria-invalid", mal ? "true" : "false"); return mal; };
  if (marcar("fFecha", !v.fecha || v.fecha > hoyAr())) faltan.push("fecha");
  if (marcar("fNombre", v.nombre.length < 3 || v.nombre.split(" ").length < 2)) faltan.push("nombre y apellido");
  if (marcar("fEmpresa", !v.empresa)) faltan.push("empresa");
  if (marcar("fCargo", !v.cargo)) faltan.push("cargo");
  if (marcar("fArea", !v.area)) faltan.push("área");
  if (marcar("fEmail", !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email))) faltan.push("mail");
  if (marcar("fCalif", !v.calificacion)) faltan.push("calificación");
  if (faltan.length) { $("fMsg").innerHTML = `<div class="msg err">Revise: ${faltan.join(", ")}.</div>`; return; }

  $("fBtn").disabled = true; $("fMsg").innerHTML = "";
  const { data, error } = await sb.rpc("academy_registrar", {
    p_fecha: v.fecha, p_nombre: v.nombre, p_empresa: v.empresa, p_cargo: v.cargo, p_area: v.area,
    p_email: v.email, p_calificacion: v.calificacion, p_observaciones: v.observaciones || null,
  });
  $("fBtn").disabled = false;
  if (error) {
    const txt = error.code === "P0001" ? error.message : "No se pudo enviar. Revise la conexión y pruebe de nuevo.";
    $("fMsg").innerHTML = `<div class="msg err">${esc(txt)}</div>`;
    return;
  }
  try { localStorage.setItem(GUARDADO, JSON.stringify({ nombre: v.nombre, email: v.email, empresa: v.empresa, cargo: v.cargo, area: v.area })); } catch { /* sin almacenamiento local */ }
  $("lTitulo").textContent = data === "actualizado" ? "¡Datos actualizados!" : "¡Gracias por registrarse!";
  $("lTexto").innerHTML = `<b>${esc(v.nombre)}</b>, quedó registrada su asistencia a la capacitación del ${esc(fechaAr(v.fecha))}. El certificado se enviará a <b>${esc(v.email)}</b>.`;
  $("formCard").hidden = true; $("listo").hidden = false; window.scrollTo(0, 0);
});
document.querySelectorAll("#form input, #form textarea").forEach((el) => el.addEventListener("input", () => el.removeAttribute("aria-invalid")));
