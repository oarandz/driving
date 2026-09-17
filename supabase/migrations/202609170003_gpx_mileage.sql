-- GPS mileage and optional completion directly from an uploaded recording.
begin;
alter table public.lessons add column if not exists route_distance_miles double precision check (route_distance_miles>=0 and route_distance_miles<'Infinity'::float8);
create or replace function public.gpx_route_miles(p_id uuid) returns double precision language sql stable set search_path='' as $$
 with ordered as (
  select lat,lng,recorded_at,lag(lat) over w as prev_lat,lag(lng) over w as prev_lng,lag(recorded_at) over w as prev_time
  from public.route_points where lesson_id=p_id and segment_id is not null
  window w as (partition by segment_id order by recorded_at,lat,lng)
 )
 select coalesce(sum(2*6371008.8*asin(sqrt(least(1.0,greatest(0.0,
  power(sin(radians(lat-prev_lat)/2),2)+cos(radians(prev_lat))*cos(radians(lat))*power(sin(radians(lng-prev_lng)/2),2)
 ))))/1609.344),0) from ordered where recorded_at>prev_time and recorded_at-prev_time<=interval '90 seconds';
$$;
revoke all on function public.gpx_route_miles(uuid) from public,anon,authenticated;
update public.lessons set route_distance_miles=public.gpx_route_miles(id) where route_imported_at is not null;
-- Replace only the original status/mileage checks; keep date, odometer and booking constraints.
do $$declare c record;begin
 for c in select conname from pg_constraint where conrelid='public.lessons'::regclass and contype='c'
   and pg_get_constraintdef(oid) like '%status%' and pg_get_constraintdef(oid) like '%mileage%' loop
  execute format('alter table public.lessons drop constraint %I',c.conname);
 end loop;
end$$;
alter table public.lessons add constraint lesson_started_time_required check (status not in ('active','completed') or started_at is not null);
alter table public.lessons add constraint active_odometer_required check (status<>'active' or start_mileage is not null);
alter table public.lessons add constraint completed_driving_record_required check (status<>'completed' or (ended_at is not null and ((start_mileage is not null and end_mileage is not null) or route_distance_miles is not null)));
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
  update public.lessons set route_file_name=p_filename,route_imported_at=now(),route_distance_miles=public.gpx_route_miles(p_id) where id=p_id;
  return inserted;
end;
$$;
revoke all on function public.save_gpx_route(uuid,text,jsonb) from public,anon;
grant execute on function public.save_gpx_route(uuid,text,jsonb) to authenticated;
create or replace function public.save_gpx_lesson(p_id uuid,p_filename text,p_points jsonb,p_complete boolean)
returns integer language plpgsql security definer set search_path='' as $$
declare l public.lessons; inserted integer; first_time timestamptz; last_time timestamptz;
begin
 if not public.is_instructor() then raise exception 'Instructor access required'; end if;
 perform pg_advisory_xact_lock(9123041);
 select * into l from public.lessons where id=p_id for update;
 if not found or l.status='cancelled' then raise exception 'Lesson unavailable'; end if;
 if p_complete is null then raise exception 'Choose whether to complete this lesson'; end if;
 if p_complete and l.status<>'scheduled' then raise exception 'Only a booked lesson can be completed from a recording. Reopen the lesson.'; end if;
 inserted:=public.save_gpx_route(p_id,p_filename,p_points);
 if p_complete then
  select min(recorded_at),max(recorded_at) into first_time,last_time from jsonb_to_recordset(p_points) as p(recorded_at timestamptz);
  if last_time<=first_time then raise exception 'The recording needs different start and finish times to complete the lesson'; end if;
  update public.lessons set status='completed',started_at=first_time,ended_at=last_time where id=p_id;
 end if;
 return inserted;
end;
$$;
revoke all on function public.save_gpx_lesson(uuid,text,jsonb,boolean) from public,anon;
grant execute on function public.save_gpx_lesson(uuid,text,jsonb,boolean) to authenticated;
commit;
