-- Backfill seguro de fichajes.user_remote_id a partir del user_id local histórico.
-- Ejecutar en Supabase SQL Editor después de haber creado fichajes.user_remote_id.
-- Solo actualiza fichajes sin UUID y local_id que identifica exactamente un usuario.
-- No convierte IDs enteros en UUID ni altera user_id.

begin;

with usuarios_unicos as (
    select local_id, min(id::text)::uuid as user_remote_id
    from public.usuarios
    where local_id is not null
    group by local_id
    having count(*) = 1
), actualizados as (
    update public.fichajes as f
       set user_remote_id = u.user_remote_id
      from usuarios_unicos as u
     where f.user_remote_id is null
       and f.user_id = u.local_id
    returning f.id, f.user_id, f.user_remote_id
)
select count(*) as fichajes_actualizados from actualizados;

commit;

-- Verificación: fichajes aún no vinculados. Puede incluir IDs sin usuario coincidente
-- o colisiones de local_id que el backfill omitió deliberadamente.
select f.id as fichaje_remote_id,
       f.user_id as user_id_historico,
       f.nombre_usuario,
       count(u.id) as usuarios_con_ese_local_id
from public.fichajes f
left join public.usuarios u on u.local_id = f.user_id
where f.user_remote_id is null
  and f.user_id is not null
group by f.id, f.user_id, f.nombre_usuario
order by f.user_id, f.id;

-- Diagnóstico de local_id duplicados en usuarios; esos valores no se asignan.
select local_id, count(*) as cantidad, array_agg(id order by id) as usuarios_remote_id
from public.usuarios
where local_id is not null
group by local_id
having count(*) > 1
order by local_id;
