# CLEAN SEA Academy

Módulo de Integra Clean Sea para cursos y certificados de asistencia.

- **QR fijo y base de personas:** el instructor usa siempre el mismo QR, que lleva a `/registro` (fecha de la capacitación, nombre y apellido, empresa, cargo, área, mail, calificación de 1 a 5 y observaciones). Cada respuesta entra a la base maestra (pestaña Personas: búsqueda, exportación a Excel, importación de planillas viejas del Forms o pegado desde Excel).
- **Cursos:** se crea el curso (título y fecha) y se eligen de la base, con casillas, los participantes a los que se les da el diploma.
- **Diplomas por mail:** al terminar, se envía a cada inscripto su certificado en PDF. Lo manda la Edge Function `academy-enviar-diploma` a través de Resend.
- **Generador:** Individual, Masivo (Excel/CSV → ZIP por empresa), Vista previa, Descargas y Registro. Es el mismo generador que el artefacto original, con la misma plantilla y las mismas tipografías (`public/assets`).

## Estructura

| Ruta | Qué es |
| --- | --- |
| `index.html`, `src/main.js`, `src/app.js` | App interna (login de Integra; requiere admin o el módulo `academy` en `user_roles`) |
| `inscripcion.html`, `src/inscripcion.js` | Formulario público del QR fijo: `/registro` |
| `src/core.js` | Armado del PDF del certificado (pdf-lib + fontkit) |
| `supabase/migrations` | Tablas `academy_personas`, `academy_respuestas`, `academy_cursos`, `academy_inscripciones`, `academy_emisiones` y las funciones `academy_registrar` (pública) / `academy_importar` |
| `supabase/functions/academy-enviar-diploma` | Envío del certificado por mail |

## Desarrollo

```bash
npm install
cp .env.example .env.local   # completar VITE_SUPABASE_ANON_KEY
npm run dev
```

## Configuración del mail (Supabase → Edge Functions → Secrets)

- `ACADEMY_RESEND_API_KEY` (no `RESEND_API_KEY`: ese nombre ya lo usa Reparaciones en el mismo Supabase)
- `ACADEMY_MAIL_FROM`, por ejemplo `CLEAN SEA Academy <academy@cleansea.com.ar>`. El dominio tiene que estar verificado en Resend.
- `ACADEMY_MAIL_REPLY_TO` (opcional)

## Accesos

Lo usan los admin de Integra o quienes tengan `academy` en `user_roles.modulos`. El formulario del QR es público: solo puede registrar respuestas (función `academy_registrar`) y no puede leer la base.
