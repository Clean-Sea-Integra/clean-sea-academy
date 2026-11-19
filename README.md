# CLEAN SEA Academy

Módulo de Integra Clean Sea para cursos y certificados de asistencia.

- **Cursos:** se crea el curso y se proyecta un QR. Los participantes lo escanean y completan nombre, DNI, empresa, cargo, email y teléfono. La lista aparece en vivo.
- **Diplomas por mail:** al terminar, se envía a cada inscripto su certificado en PDF. Lo manda la Edge Function `academy-enviar-diploma` a través de Resend.
- **Generador:** Individual, Masivo (Excel/CSV → ZIP por empresa), Vista previa, Descargas y Registro. Es el mismo generador que el artefacto original, con la misma plantilla y las mismas tipografías (`public/assets`).

## Estructura

| Ruta | Qué es |
| --- | --- |
| `index.html`, `src/main.js`, `src/app.js` | App interna (login de Integra; requiere admin o el módulo `academy` en `user_roles`) |
| `inscripcion.html`, `src/inscripcion.js` | Formulario público del QR: `/i/<token>` |
| `src/core.js` | Armado del PDF del certificado (pdf-lib + fontkit) |
| `supabase/migrations` | Tablas `academy_cursos`, `academy_inscripciones`, `academy_emisiones` y las funciones `academy_curso_publico` / `academy_inscribir` |
| `supabase/functions/academy-enviar-diploma` | Envío del certificado por mail |

## Desarrollo

```bash
npm install
cp .env.example .env.local   # completar VITE_SUPABASE_ANON_KEY
npm run dev
```

## Configuración del mail (Supabase → Edge Functions → Secrets)

- `RESEND_API_KEY`
- `ACADEMY_MAIL_FROM`, por ejemplo `CLEAN SEA Academy <academy@cleansea.com.ar>`. El dominio tiene que estar verificado en Resend.
- `ACADEMY_MAIL_REPLY_TO` (opcional)

## Accesos

Lo usan los admin de Integra o quienes tengan `academy` en `user_roles.modulos`. El formulario del QR es público, pero solo puede inscribir en un curso con la inscripción abierta. No puede leer datos de otros inscriptos.
