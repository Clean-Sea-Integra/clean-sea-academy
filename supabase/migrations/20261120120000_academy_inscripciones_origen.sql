-- Inscriptos importados desde las respuestas de Microsoft Forms (QR del instructor).
alter table public.academy_inscripciones
  add column origen text not null default 'qr' check (origen in ('qr','forms','manual')),
  add column respondido_at timestamptz;
comment on column public.academy_inscripciones.respondido_at is 'Hora de la respuesta en Microsoft Forms (importada).';
