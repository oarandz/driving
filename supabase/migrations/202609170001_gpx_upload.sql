-- Apply after the initial migration. Existing lessons and routes are preserved.
begin;
alter table public.route_points add column if not exists segment_id uuid;
alter table public.lessons add column if not exists route_file_name text;
alter table public.lessons add column if not exists route_imported_at timestamptz;

create or replace function public.save_gpx_route(p_id uuid,p_filename text,p_points jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare lesson public.lessons; inserted integer;
begin
  if not public.is_instructor() then raise exception 'Instructor access required'; end if;
  select * into lesson from public.lessons where id=p_id for update;
  if not found or lesson.status='cancelled' then raise exception 'Lesson unavailable'; end if;
  if p_filename is null or length(trim(p_filename)) not between 1 and 255 then raise exception 'Invalid file name'; end if;
  if p_points is null or jsonb_typeof(p_points)<>'array' then raise exception 'Invalid route'; end if;
  if jsonb_array_length(p_points) not between 1 and 30000 then raise exception 'Route must contain between 1 and 30000 GPS points'; end if;
  if exists(
    select 1 from jsonb_to_recordset(p_points) as p(lat float8,lng float8,recorded_at timestamptz,segment_id uuid)
    where p.lat is null or p.lat not between -90 and 90 or p.lng is null or p.lng not between -180 and 180
      or p.recorded_at is null or not isfinite(p.recorded_at) or p.segment_id is null
  ) then raise exception 'Invalid GPS coordinates or recording times'; end if;
  insert into public.route_points(lesson_id,lat,lng,accuracy,recorded_at,segment_id)
    select p_id,p.lat,p.lng,0,p.recorded_at,p.segment_id
    from jsonb_to_recordset(p_points) as p(lat float8,lng float8,recorded_at timestamptz,segment_id uuid)
    on conflict (lesson_id,recorded_at,lat,lng) do nothing;
  get diagnostics inserted = row_count;
  update public.lessons set route_file_name=p_filename,route_imported_at=now() where id=p_id;
  return inserted;
end;
$$;
revoke all on function public.save_gpx_route(uuid,text,jsonb) from public,anon;
grant execute on function public.save_gpx_route(uuid,text,jsonb) to authenticated;
commit;
