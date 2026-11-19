-- CLEAN SEA Academy: cursos, inscripciones por QR y registro de diplomas emitidos.
-- Supabase compartido del grupo. Acceso interno: admin o módulo 'academy' en user_roles.
-- Acceso público (QR): solo por las funciones academy_curso_publico y academy_inscribir.

create or replace function public.academy_puede()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and (rol = 'admin' or 'academy' = any(modulos))
  );
$$;
revoke all on function public.academy_puede() from public, anon;
grant execute on function public.academy_puede() to authenticated;

create table public.academy_cursos (
  id           uuid primary key default gen_random_uuid(),
  titulo       text not null check (char_length(titulo) between 3 and 300),
  titulo_corto text check (char_length(titulo_corto) <= 80),
  fecha        date not null,
  lugar        text check (char_length(lugar) <= 200),
  instructor   text check (char_length(instructor) <= 200),
  token        text not null unique default encode(extensions.gen_random_bytes(8), 'hex'),
  abierto      boolean not null default true,
  creado_por   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);

create table public.academy_inscripciones (
  id                 uuid primary key default gen_random_uuid(),
  curso_id           uuid not null references public.academy_cursos(id) on delete cascade,
  nombre             text not null check (char_length(nombre) between 3 and 120),
  empresa            text not null check (char_length(empresa) between 1 and 120),
  dni                text not null check (dni ~ '^[A-Z0-9]{5,20}$'),
  email              text not null check (char_length(email) <= 200),
  telefono           text check (char_length(telefono) <= 40),
  cargo              text check (char_length(cargo) <= 120),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  diploma_enviado_at timestamptz,
  diploma_enviado_a  text,
  diploma_lote       text,
  unique (curso_id, dni)
);
create index on public.academy_inscripciones (curso_id);
create index on public.academy_inscripciones (lower(email));

-- Registro de emisiones: mismo documento que usaba el generador (lote, curso, certificados[]).
create table public.academy_emisiones (
  id            text primary key check (id ~ '^[A-Za-z0-9_\-.~:@+]{1,200}$'),
  data          jsonb not null,
  curso_id      uuid references public.academy_cursos(id) on delete set null,
  emisor        uuid default auth.uid(),
  emisor_nombre text,
  created_at    timestamptz not null default now()
);

alter table public.academy_cursos        enable row level security;
alter table public.academy_inscripciones enable row level security;
alter table public.academy_emisiones     enable row level security;

create policy academy_cursos_equipo on public.academy_cursos
  for all to authenticated using (public.academy_puede()) with check (public.academy_puede());
create policy academy_inscripciones_equipo on public.academy_inscripciones
  for all to authenticated using (public.academy_puede()) with check (public.academy_puede());
create policy academy_emisiones_equipo on public.academy_emisiones
  for all to authenticated using (public.academy_puede()) with check (public.academy_puede());

revoke all on public.academy_cursos, public.academy_inscripciones, public.academy_emisiones from anon;

-- Lo que ve el participante al escanear el QR (sin datos de otros inscriptos).
create or replace function public.academy_curso_publico(p_token text)
returns table (titulo text, fecha date, lugar text, abierto boolean)
language sql stable security definer set search_path = public as $$
  select c.titulo, c.fecha, c.lugar, c.abierto from public.academy_cursos c where c.token = p_token;
$$;

-- Inscripción desde el QR. Si el mismo documento se vuelve a anotar en el curso, se actualizan sus datos.
create or replace function public.academy_inscribir(
  p_token text, p_nombre text, p_empresa text, p_dni text, p_email text, p_telefono text, p_cargo text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_curso public.academy_cursos;
  v_dni   text := upper(regexp_replace(coalesce(p_dni, ''), '[^A-Za-z0-9]', '', 'g'));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_nom   text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_emp   text := regexp_replace(btrim(coalesce(p_empresa, '')), '\s+', ' ', 'g');
  v_tel   text := nullif(btrim(coalesce(p_telefono, '')), '');
  v_car   text := nullif(regexp_replace(btrim(coalesce(p_cargo, '')), '\s+', ' ', 'g'), '');
  v_nuevo boolean;
begin
  select * into v_curso from public.academy_cursos where token = p_token;
  if not found then raise exception 'Curso inexistente' using errcode = 'P0001'; end if;
  if not v_curso.abierto then raise exception 'La inscripción a este curso está cerrada' using errcode = 'P0001'; end if;
  if char_length(v_nom) < 3 or char_length(v_nom) > 120 then raise exception 'Revisá el nombre y apellido' using errcode = 'P0001'; end if;
  if char_length(v_emp) < 1 or char_length(v_emp) > 120 then raise exception 'Revisá la empresa' using errcode = 'P0001'; end if;
  if v_dni !~ '^[A-Z0-9]{5,20}$' then raise exception 'Revisá el DNI o pasaporte' using errcode = 'P0001'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 200 then raise exception 'Revisá el email' using errcode = 'P0001'; end if;
  if v_tel is not null and (v_tel !~ '^[0-9+()\-\s.]{6,40}$') then raise exception 'Revisá el teléfono' using errcode = 'P0001'; end if;
  if v_car is not null and char_length(v_car) > 120 then raise exception 'Revisá el cargo' using errcode = 'P0001'; end if;
  if (select count(*) from public.academy_inscripciones where curso_id = v_curso.id) >= 1000 then
    raise exception 'El curso alcanzó el máximo de inscriptos' using errcode = 'P0001';
  end if;

  insert into public.academy_inscripciones as i (curso_id, nombre, empresa, dni, email, telefono, cargo)
  values (v_curso.id, v_nom, v_emp, v_dni, v_email, v_tel, v_car)
  on conflict (curso_id, dni) do update
    set nombre = excluded.nombre, empresa = excluded.empresa, email = excluded.email,
        telefono = excluded.telefono, cargo = excluded.cargo, updated_at = now()
  returning (xmax = 0) into v_nuevo;
  return case when v_nuevo then 'ok' else 'actualizado' end;
end;
$$;

revoke all on function public.academy_curso_publico(text) from public;
revoke all on function public.academy_inscribir(text, text, text, text, text, text, text) from public;
grant execute on function public.academy_curso_publico(text) to anon, authenticated;
grant execute on function public.academy_inscribir(text, text, text, text, text, text, text) to anon, authenticated;

-- Lista de inscriptos en vivo mientras se dicta el curso.
alter publication supabase_realtime add table public.academy_inscripciones;
