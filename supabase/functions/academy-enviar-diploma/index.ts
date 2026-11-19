// CLEAN SEA Academy — envía por mail el certificado de un inscripto.
// El PDF se arma en el navegador (misma plantilla que el generador) y llega acá en base64.
// El destinatario se toma de la base, no del cliente: solo quien ve la inscripción (RLS academy_puede) puede enviar.
// Secretos: ACADEMY_RESEND_API_KEY (no usar RESEND_API_KEY: es de Reparaciones), ACADEMY_MAIL_FROM (ej. "CLEAN SEA Academy <academy@cleansea.com.ar>"),
//           ACADEMY_MAIL_REPLY_TO (opcional).
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fechaAr = (iso: string) => iso.split("-").reverse().join("/");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Método no permitido" });

  const auth = req.headers.get("Authorization") ?? "";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });

  let body: { inscripcion_id?: string; filename?: string; pdf_base64?: string; lote?: string };
  try { body = await req.json(); } catch { return json(400, { error: "Cuerpo inválido" }); }
  const { inscripcion_id, pdf_base64 } = body;
  const lote = String(body.lote ?? "").slice(0, 60);
  if (!inscripcion_id || !/^[0-9a-f-]{36}$/i.test(inscripcion_id)) return json(400, { error: "Falta la inscripción" });
  if (!pdf_base64 || pdf_base64.length > 4_000_000) return json(400, { error: "PDF faltante o demasiado grande" });
  if (!atob(pdf_base64.slice(0, 8)).startsWith("%PDF")) return json(400, { error: "El adjunto no es un PDF" });
  const filename = String(body.filename ?? "Certificado.pdf").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").slice(0, 180);

  const { data: ins, error } = await sb
    .from("academy_inscripciones")
    .select("id, nombre, email, curso:academy_cursos(titulo, fecha, lugar)")
    .eq("id", inscripcion_id)
    .maybeSingle();
  if (error) return json(500, { error: error.message });
  if (!ins) return json(403, { error: "Sin acceso a esta inscripción" });

  const key = Deno.env.get("ACADEMY_RESEND_API_KEY");
  const from = Deno.env.get("ACADEMY_MAIL_FROM");
  if (!key || !from) return json(503, { error: "El envío de mails no está configurado todavía (faltan ACADEMY_RESEND_API_KEY y ACADEMY_MAIL_FROM)." });

  // deno-lint-ignore no-explicit-any
  const curso = (ins as any).curso as { titulo: string; fecha: string; lugar: string | null };
  const nombre = ins.nombre.split(" ")[0];
  const html = `<!doctype html><html><body style="margin:0;background:#F4F6F9;font-family:Segoe UI,Arial,sans-serif;color:#0E1C2B">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #E1E6EC;border-radius:10px">
<tr><td style="padding:22px 28px;border-bottom:3px solid #009460">
<span style="font:800 20px Arial,sans-serif;color:#1B3765;letter-spacing:.02em">CLEAN SEA <span style="color:#009460">ACADEMY</span></span></td></tr>
<tr><td style="padding:24px 28px;font-size:15px;line-height:1.55">
<p style="margin:0 0 12px">Hola ${esc(nombre)}:</p>
<p style="margin:0 0 12px">Gracias por participar del curso <b>${esc(curso.titulo)}</b> el ${esc(fechaAr(curso.fecha))}${curso.lugar ? " en " + esc(curso.lugar) : ""}.</p>
<p style="margin:0 0 12px">Te adjuntamos tu <b>certificado de asistencia</b> en PDF.</p>
<p style="margin:0">Saludos,<br>Equipo CLEAN SEA Academy</p></td></tr>
<tr><td style="padding:14px 28px;background:#F2F4F7;font-size:12px;color:#55606E;border-radius:0 0 10px 10px">CLEAN SEA S.A.</td></tr>
</table></td></tr></table></body></html>`;

  const replyTo = Deno.env.get("ACADEMY_MAIL_REPLY_TO");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(lote ? { "Idempotency-Key": `${lote}-${ins.id}` } : {}),
    },
    body: JSON.stringify({
      from,
      to: [ins.email],
      ...(replyTo ? { reply_to: replyTo } : {}),
      subject: `Tu certificado — ${curso.titulo}`,
      html,
      attachments: [{ filename, content: pdf_base64 }],
    }),
  });
  if (!r.ok) {
    let det = "";
    try { det = (await r.json()).message ?? ""; } catch { /* sin detalle */ }
    return json(502, { error: `El proveedor de mail rechazó el envío${det ? ": " + det : ""}` });
  }

  const up = await sb.from("academy_inscripciones")
    .update({ diploma_enviado_at: new Date().toISOString(), diploma_enviado_a: ins.email, diploma_lote: lote || null })
    .eq("id", ins.id);
  if (up.error) return json(200, { ok: true, email: ins.email, aviso: "Enviado, pero no se pudo marcar: " + up.error.message });
  return json(200, { ok: true, email: ins.email });
});
