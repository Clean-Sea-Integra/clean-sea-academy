-- QR fijo (pedido del usuario, 20/11/2026): el instructor usa siempre el mismo QR en sus presentaciones.
-- Lleva a /registro, el mismo cuestionario que el Microsoft Forms "Registro de Asistencia":
-- fecha de la capacitación, nombre y apellido, empresa, cargo, área, mail, calificación (1 a 5) y observaciones.
-- Cada envío alimenta la base maestra de personas (una por mail) y queda como respuesta (una por persona y fecha).
-- Después, desde el curso, se elige de la base a quién darle el diploma (pasa a academy_inscripciones).

create table public.academy_personas (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique check (email = lower(email) and char_length(email) <= 200),
  nombre      text not null check (char_length(nombre) between 3 and 120),
  empresa     text not null check (char_length(empresa) between 1 and 120),
  cargo       text check (char_length(cargo) <= 120),
  area        text check (char_length(area) <= 120),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.academy_personas is 'CLEAN SEA Academy: base maestra de personas que respondieron el registro de asistencia (datos más recientes).';

create table public.academy_respuestas (
  id             uuid primary key default gen_random_uuid(),
  persona_id     uuid not null references public.academy_personas(id) on delete cascade,
  fecha          date not null,
  nombre         text not null check (char_length(nombre) between 3 and 120),
  email          text not null check (char_length(email) <= 200),
  empresa        text not null check (char_length(empresa) between 1 and 120),
  cargo          text check (char_length(cargo) <= 120),
  area           text check (char_length(area) <= 120),
  calificacion   smallint check (calificacion between 1 and 5),
  observaciones  text check (char_length(observaciones) <= 2000),
  origen         text not null default 'qr' check (origen in ('qr','forms','excel')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (persona_id, fecha)
);
comment on table public.academy_respuestas is 'CLEAN SEA Academy: cada registro de asistencia (una fila por persona y fecha de capacitación).';
comment on column public.academy_respuestas.fecha is 'Fecha de la capacitación que indicó la persona.';
create index academy_respuestas_fecha on public.academy_respuestas (fecha desc);

alter table public.academy_inscripciones
  add column cargo        text check (char_length(cargo) <= 120),
  add column persona_id   uuid references public.academy_personas(id) on delete set null,
  add column respuesta_id uuid references public.academy_respuestas(id) on delete set null;
alter table public.academy_inscripciones drop constraint academy_inscripciones_origen_check;
alter table public.academy_inscripciones add constraint academy_inscripciones_origen_check
  check (origen in ('qr','forms','manual','base'));
create index academy_inscripciones_respuesta on public.academy_inscripciones (respuesta_id);

alter table public.academy_personas   enable row level security;
alter table public.academy_respuestas enable row level security;
create policy academy_personas_equipo on public.academy_personas
  for all to authenticated using (public.academy_puede()) with check (public.academy_puede());
create policy academy_respuestas_equipo on public.academy_respuestas
  for all to authenticated using (public.academy_puede()) with check (public.academy_puede());
revoke all on public.academy_personas, public.academy_respuestas from anon;

alter publication supabase_realtime add table public.academy_respuestas;

-- Alta o actualización de una respuesta (uso interno de academy_registrar y academy_importar).
-- La ficha de la persona solo se pisa con datos de una capacitación igual o más reciente que la última conocida.
create function public.academy_guardar_respuesta(
  p_fecha date, p_nombre text, p_empresa text, p_cargo text, p_area text, p_email text,
  p_calificacion int, p_observaciones text, p_origen text, p_pisar boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_nom   text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_emp   text := regexp_replace(btrim(coalesce(p_empresa, '')), '\s+', ' ', 'g');
  v_car   text := nullif(regexp_replace(btrim(coalesce(p_cargo, '')), '\s+', ' ', 'g'), '');
  v_area  text := nullif(regexp_replace(btrim(coalesce(p_area, '')), '\s+', ' ', 'g'), '');
  v_obs   text := nullif(btrim(coalesce(p_observaciones, '')), '');
  v_per   uuid;
  v_ult   date;
  v_res   uuid;
begin
  if p_fecha is null then raise exception 'Indicá la fecha de la capacitación' using errcode = 'P0001'; end if;
  if char_length(v_nom) < 3 or char_length(v_nom) > 120 then raise exception 'Revisá el nombre y apellido' using errcode = 'P0001'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 200 then raise exception 'Revisá el mail' using errcode = 'P0001'; end if;
  if char_length(v_emp) < 1 or char_length(v_emp) > 120 then raise exception 'Revisá la empresa' using errcode = 'P0001'; end if;
  if char_length(v_car) > 120 or char_length(v_area) > 120 then raise exception 'Revisá el cargo y el área' using errcode = 'P0001'; end if;
  if p_calificacion is not null and p_calificacion not between 1 and 5 then raise exception 'Revisá la calificación' using errcode = 'P0001'; end if;
  if char_length(v_obs) > 2000 then raise exception 'Las observaciones son demasiado largas' using errcode = 'P0001'; end if;

  select id into v_per from public.academy_personas where email = v_email;
  if v_per is null then
    insert into public.academy_personas (email, nombre, empresa, cargo, area)
    values (v_email, v_nom, v_emp, v_car, v_area)
    on conflict (email) do nothing returning id into v_per;
    if v_per is null then select id into v_per from public.academy_personas where email = v_email; end if;
  else
    select max(fecha) into v_ult from public.academy_respuestas where persona_id = v_per;
    if v_ult is null or p_fecha >= v_ult then
      update public.academy_personas
         set nombre = v_nom, empresa = v_emp, cargo = coalesce(v_car, cargo), area = coalesce(v_area, area), updated_at = now()
       where id = v_per;
    end if;
  end if;

  select id into v_res from public.academy_respuestas where persona_id = v_per and fecha = p_fecha;
  if v_res is null then
    insert into public.academy_respuestas (persona_id, fecha, nombre, email, empresa, cargo, area, calificacion, observaciones, origen)
    values (v_per, p_fecha, v_nom, v_email, v_emp, v_car, v_area, p_calificacion, v_obs, p_origen);
    return 'ok';
  elsif p_pisar then
    update public.academy_respuestas
       set nombre = v_nom, empresa = v_emp, cargo = v_car, area = v_area,
           calificacion = coalesce(p_calificacion, calificacion), observaciones = coalesce(v_obs, observaciones), updated_at = now()
     where id = v_res;
    return 'actualizado';
  end if;
  return 'existente';
end;
$$;
revoke all on function public.academy_guardar_respuesta(date, text, text, text, text, text, int, text, text, boolean) from public, anon, authenticated;

-- Formulario público del QR fijo. Si la misma persona vuelve a enviar para la misma fecha, se actualiza.
create function public.academy_registrar(
  p_fecha date, p_nombre text, p_empresa text, p_cargo text, p_area text, p_email text,
  p_calificacion int, p_observaciones text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_hoy date := (now() at time zone 'America/Argentina/Buenos_Aires')::date;
begin
  if p_fecha is null or p_fecha > v_hoy + 1 or p_fecha < v_hoy - 60 then
    raise exception 'Revisá la fecha de la capacitación' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_cargo, '')), '') is null then raise exception 'Revisá el cargo' using errcode = 'P0001'; end if;
  if nullif(btrim(coalesce(p_area, '')), '') is null then raise exception 'Revisá el área' using errcode = 'P0001'; end if;
  if p_calificacion is null then raise exception 'Calificá la capacitación' using errcode = 'P0001'; end if;
  if (select count(*) from public.academy_respuestas where created_at > now() - interval '1 hour') >= 600 then
    raise exception 'Demasiados registros en este momento. Probá de nuevo en unos minutos.' using errcode = 'P0001';
  end if;
  return public.academy_guardar_respuesta(p_fecha, p_nombre, p_empresa, p_cargo, p_area, p_email,
    p_calificacion, p_observaciones, 'qr', true);
end;
$$;
revoke all on function public.academy_registrar(date, text, text, text, text, text, int, text) from public;
grant execute on function public.academy_registrar(date, text, text, text, text, text, int, text) to anon, authenticated;

-- Carga de planillas viejas (Forms o filas pegadas de Excel) en la base. Lo que ya existe no se toca.
create function public.academy_importar(p_filas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f jsonb; r text; n_ok int := 0; n_ya int := 0; errores jsonb := '[]'::jsonb;
begin
  if not public.academy_puede() then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) > 2000 then
    raise exception 'Se importan hasta 2000 filas por vez' using errcode = 'P0001';
  end if;
  for f in select * from jsonb_array_elements(p_filas) loop
    begin
      r := public.academy_guardar_respuesta((f->>'fecha')::date, f->>'nombre', coalesce(nullif(f->>'empresa', ''), 'Sin empresa'),
        f->>'cargo', f->>'area', f->>'email', (f->>'calificacion')::int, f->>'observaciones',
        case when f->>'origen' in ('forms','excel') then f->>'origen' else 'excel' end, false);
      if r = 'ok' then n_ok := n_ok + 1; else n_ya := n_ya + 1; end if;
    exception when others then
      errores := errores || jsonb_build_object('fila', f->'fila', 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('nuevas', n_ok, 'existentes', n_ya, 'errores', errores);
end;
$$;
revoke all on function public.academy_importar(jsonb) from public, anon;
grant execute on function public.academy_importar(jsonb) to authenticated;

-- El QR por curso deja de usarse: ya no hay inscripción pública directa a un curso.
drop function if exists public.academy_inscribir(text, text, text, text, text, text);
drop function if exists public.academy_curso_publico(text);
