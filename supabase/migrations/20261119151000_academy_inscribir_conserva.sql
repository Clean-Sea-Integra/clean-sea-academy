-- Reinscribirse sin teléfono o cargo conserva los cargados antes.
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
        telefono = coalesce(excluded.telefono, i.telefono), cargo = coalesce(excluded.cargo, i.cargo),
        updated_at = now()
  returning (xmax = 0) into v_nuevo;
  return case when v_nuevo then 'ok' else 'actualizado' end;
end;
$$;
