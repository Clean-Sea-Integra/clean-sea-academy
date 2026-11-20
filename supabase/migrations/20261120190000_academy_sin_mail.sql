-- Personas sin mail (planillas viejas que no lo traen). Se las identifica por nombre + empresa
-- hasta que se les complete el mail desde la app (academy_completar_mail). Sin mail no se envía diploma.
alter table public.academy_personas      alter column email drop not null;
alter table public.academy_respuestas    alter column email drop not null;
alter table public.academy_inscripciones alter column email drop not null;
create unique index if not exists academy_inscripciones_curso_persona
  on public.academy_inscripciones (curso_id, persona_id) where persona_id is not null;

create or replace function public.academy_guardar_respuesta(
  p_fecha date, p_nombre text, p_empresa text, p_cargo text, p_area text, p_email text,
  p_calificacion int, p_observaciones text, p_origen text, p_pisar boolean)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
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
  if v_email is null and p_origen = 'qr' then raise exception 'Revisá el mail' using errcode = 'P0001'; end if;
  if v_email is not null and (v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 200) then raise exception 'Revisá el mail' using errcode = 'P0001'; end if;
  if char_length(v_emp) < 1 or char_length(v_emp) > 120 then raise exception 'Revisá la empresa' using errcode = 'P0001'; end if;
  if char_length(v_car) > 120 or char_length(v_area) > 120 then raise exception 'Revisá el cargo y el área' using errcode = 'P0001'; end if;
  if p_calificacion is not null and p_calificacion not between 1 and 5 then raise exception 'Revisá la calificación' using errcode = 'P0001'; end if;
  if char_length(v_obs) > 2000 then raise exception 'Las observaciones son demasiado largas' using errcode = 'P0001'; end if;

  if v_email is not null then
    select id into v_per from public.academy_personas where email = v_email;
  else
    select id into v_per from public.academy_personas
     where email is null and lower(nombre) = lower(v_nom) and lower(empresa) = lower(v_emp) limit 1;
  end if;
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

-- Completar (o corregir) el mail de una persona. Si ese mail ya es de otra persona de la base
-- (por ejemplo, porque después se registró con el QR), se unifican en esa: sus respuestas y cursos pasan a ella.
create or replace function public.academy_completar_mail(p_persona uuid, p_email text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_otra  uuid;
begin
  if not public.academy_puede() then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 200 then raise exception 'Revisá el mail' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.academy_personas where id = p_persona) then raise exception 'La persona ya no está en la base' using errcode = 'P0001'; end if;
  select id into v_otra from public.academy_personas where email = v_email and id <> p_persona;
  if v_otra is null then
    update public.academy_personas set email = v_email, updated_at = now() where id = p_persona;
    update public.academy_respuestas set email = v_email, updated_at = now() where persona_id = p_persona;
    update public.academy_inscripciones set email = v_email, updated_at = now() where persona_id = p_persona and diploma_enviado_at is null;
    return 'ok';
  end if;
  -- Unificar: lo que la otra ya tiene en la misma fecha o curso se queda como está.
  update public.academy_inscripciones i set respuesta_id = o.id
    from public.academy_respuestas r join public.academy_respuestas o on o.persona_id = v_otra and o.fecha = r.fecha
   where r.persona_id = p_persona and i.respuesta_id = r.id;
  delete from public.academy_respuestas r where r.persona_id = p_persona
     and exists (select 1 from public.academy_respuestas o where o.persona_id = v_otra and o.fecha = r.fecha);
  update public.academy_respuestas set persona_id = v_otra, email = v_email, updated_at = now() where persona_id = p_persona;
  delete from public.academy_inscripciones i where i.persona_id = p_persona
     and exists (select 1 from public.academy_inscripciones o where o.persona_id = v_otra and o.curso_id = i.curso_id);
  update public.academy_inscripciones set persona_id = v_otra, email = coalesce(email, v_email), updated_at = now() where persona_id = p_persona;
  delete from public.academy_personas where id = p_persona;
  return 'unificado';
end;
$$;
revoke all on function public.academy_completar_mail(uuid, text) from public, anon;
grant execute on function public.academy_completar_mail(uuid, text) to authenticated;
