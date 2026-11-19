-- Formulario del QR: nombre, mail, empresa, área y tipo de puesto (pedido del usuario, 19/11/2026).
-- Se dejan de pedir DNI, teléfono y cargo. Dentro de un curso, la persona se identifica por su mail.
-- La tabla estaba vacía al aplicar este cambio.

alter table public.academy_inscripciones drop constraint if exists academy_inscripciones_curso_id_dni_key;
alter table public.academy_inscripciones drop column dni, drop column telefono, drop column cargo;
alter table public.academy_inscripciones
  add column area   text check (char_length(area) <= 120),
  add column puesto text check (puesto in ('Director/Gerente','Jefe','Supervisor','Coordinador','Analista/Administrativo','Operador','Otro'));
create unique index academy_inscripciones_curso_email on public.academy_inscripciones (curso_id, lower(email));

drop function public.academy_inscribir(text, text, text, text, text, text, text);

create function public.academy_inscribir(
  p_token text, p_nombre text, p_email text, p_empresa text, p_area text, p_puesto text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_curso public.academy_cursos;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_nom   text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_emp   text := regexp_replace(btrim(coalesce(p_empresa, '')), '\s+', ' ', 'g');
  v_area  text := nullif(regexp_replace(btrim(coalesce(p_area, '')), '\s+', ' ', 'g'), '');
  v_pue   text := nullif(btrim(coalesce(p_puesto, '')), '');
  v_id    uuid;
  v_nuevo boolean;
begin
  select * into v_curso from public.academy_cursos where token = p_token;
  if not found then raise exception 'Curso inexistente' using errcode = 'P0001'; end if;
  if not v_curso.abierto then raise exception 'La inscripción a este curso está cerrada' using errcode = 'P0001'; end if;
  if char_length(v_nom) < 3 or char_length(v_nom) > 120 then raise exception 'Revisá el nombre y apellido' using errcode = 'P0001'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_email) > 200 then raise exception 'Revisá el mail' using errcode = 'P0001'; end if;
  if char_length(v_emp) < 1 or char_length(v_emp) > 120 then raise exception 'Revisá la empresa' using errcode = 'P0001'; end if;
  if v_area is null or char_length(v_area) > 120 then raise exception 'Revisá el área' using errcode = 'P0001'; end if;
  if v_pue is null or v_pue not in ('Director/Gerente','Jefe','Supervisor','Coordinador','Analista/Administrativo','Operador','Otro') then
    raise exception 'Elegí el tipo de puesto' using errcode = 'P0001';
  end if;
  if (select count(*) from public.academy_inscripciones where curso_id = v_curso.id) >= 1000 then
    raise exception 'El curso alcanzó el máximo de inscriptos' using errcode = 'P0001';
  end if;

  select id into v_id from public.academy_inscripciones where curso_id = v_curso.id and lower(email) = v_email;
  v_nuevo := v_id is null;
  if v_nuevo then
    insert into public.academy_inscripciones (curso_id, nombre, email, empresa, area, puesto)
    values (v_curso.id, v_nom, v_email, v_emp, v_area, v_pue);
  else
    update public.academy_inscripciones
       set nombre = v_nom, empresa = v_emp, area = v_area, puesto = v_pue, updated_at = now()
     where id = v_id;
  end if;
  return case when v_nuevo then 'ok' else 'actualizado' end;
exception when unique_violation then
  return 'actualizado';
end;
$$;

revoke all on function public.academy_inscribir(text, text, text, text, text, text) from public;
grant execute on function public.academy_inscribir(text, text, text, text, text, text) to anon, authenticated;
