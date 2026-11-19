import { supabase as sb } from "./lib/supabase.js";
import { cargarCore } from "./core.js";
import { iniciarApp } from "./app.js";

const $ = (id) => document.getElementById(id);
let iniciada = false;

function mensaje(kind, texto) {
  $("lMsg").innerHTML = texto ? `<div class="msg ${kind}">${texto}</div>` : "";
}

async function entrar(session) {
  if (!session) { $("app").hidden = true; $("login").hidden = false; return; }
  const { data: puede, error } = await sb.rpc("academy_puede");
  if (error || !puede) {
    mensaje("err", "Tu usuario no tiene acceso a CLEAN SEA Academy. Pedí que te habiliten el módulo <b>academy</b>.");
    await sb.auth.signOut();
    return;
  }
  const { data: perfil } = await sb.from("user_profiles").select("nombre").eq("user_id", session.user.id).maybeSingle();
  const me = { id: session.user.id, email: session.user.email, nombre: perfil?.nombre || session.user.email };
  $("meName").textContent = me.nombre;
  $("login").hidden = true; $("app").hidden = false;
  if (iniciada) return;
  iniciada = true;
  const C = await cargarCore();
  iniciarApp(C, sb, me);
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("lBtn").disabled = true; mensaje("", "");
  const { data, error } = await sb.auth.signInWithPassword({ email: $("lEmail").value.trim(), password: $("lPass").value });
  $("lBtn").disabled = false;
  if (error) { mensaje("err", "Email o contraseña incorrectos."); return; }
  entrar(data.session);
});
$("logout").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });

sb.auth.getSession().then(({ data }) => entrar(data.session));
