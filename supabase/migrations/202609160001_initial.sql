-- Run once in a fresh Supabase project. No real pupil data is included.
begin;
create extension if not exists btree_gist with schema extensions;

create table public.instructors (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table public.pupils (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 120),
  email text not null check (length(email) between 3 and 320),
  colour text not null default '#dbeafa' check (colour ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now()
);
create unique index pupil_email_unique on public.pupils(lower(trim(email)));
create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  pupil_id uuid not null references public.pupils(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  status text not null default 'scheduled' check (status in ('scheduled','active','completed','cancelled')),
  pickup jsonb not null,
  dropoff jsonb not null,
  fee numeric(10,2) not null default 0 check (fee >= 0),
  paid boolean not null default false,
  objectives text not null default '',
  objectives_inherited boolean not null default true,
  improved text not null default '',
  needs_work text not null default '',
  other text not null default '',
  next_aims text not null default '',
  started_at timestamptz,
  ended_at timestamptz,
  start_mileage numeric(12,1) check (start_mileage >= 0),
  end_mileage numeric(12,1),
  travel_before_minutes integer not null default 0 check (travel_before_minutes between 0 and 480),
  travel_source text not null default 'manual' check (travel_source in ('automatic','manual','review')),
  created_at timestamptz not null default now(),
  check (end_mileage is null or end_mileage >= start_mileage),
  check (ended_at is null or ended_at >= started_at),
  check (status not in ('active','completed') or (started_at is not null and start_mileage is not null)),
  check (status <> 'completed' or (ended_at is not null and end_mileage is not null)),
  exclude using gist (tstzrange(starts_at,ends_at,'[)') with &&) where (status <> 'cancelled')
);
create unique index only_one_active_lesson on public.lessons((status)) where status='active';
create index pupil_lessons on public.lessons(pupil_id, starts_at desc);
create table public.route_points (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy double precision not null check (accuracy between 0 and 100),
  recorded_at timestamptz not null,
  unique (lesson_id,recorded_at,lat,lng)
);
create index lesson_route_order on public.route_points(lesson_id, recorded_at, id);
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 180),
  kind text not null check (kind in ('image','video')),
  mime_type text not null check (mime_type in ('image/png','image/jpeg','image/webp','video/mp4','video/webm','video/quicktime')),
  storage_path text not null unique,
  created_at timestamptz not null default now()
);
create table public.lesson_resources (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  resource_id uuid not null references public.resources(id) on delete cascade,
  unique (lesson_id,resource_id)
);

create function public.is_instructor() returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.instructors where user_id=auth.uid());
$$;
create function public.can_read_lesson(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select public.is_instructor() or exists(select 1 from public.lessons l join public.pupils p on p.id=l.pupil_id where l.id=p_id and p.user_id=auth.uid());
$$;
create function public.can_read_resource(p_id uuid) returns boolean language sql stable security definer set search_path='' as $$
  select public.is_instructor() or exists(select 1 from public.lesson_resources lr where lr.resource_id=p_id and public.can_read_lesson(lr.lesson_id));
$$;
create function public.claim_pupil_account() returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  update public.pupils p set user_id=auth.uid()
    from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null
    and lower(trim(p.email))=lower(trim(u.email)) and (p.user_id is null or p.user_id=auth.uid());
end;
$$;
alter table public.instructors enable row level security;
alter table public.pupils enable row level security;
alter table public.lessons enable row level security;
alter table public.route_points enable row level security;
alter table public.resources enable row level security;
alter table public.lesson_resources enable row level security;
revoke all on public.instructors,public.pupils,public.lessons,public.route_points,public.resources,public.lesson_resources from anon,authenticated;
grant select on public.instructors,public.pupils,public.lessons,public.route_points,public.resources,public.lesson_resources to authenticated;
grant insert on public.pupils,public.route_points,public.resources,public.lesson_resources to authenticated;
create policy instructor_self on public.instructors for select to authenticated using (user_id=auth.uid());
create policy pupil_read on public.pupils for select to authenticated using (public.is_instructor() or user_id=auth.uid());
create policy pupil_insert on public.pupils for insert to authenticated with check (public.is_instructor() and user_id is null);
create policy lesson_read on public.lessons for select to authenticated using (public.can_read_lesson(id));
create policy route_read on public.route_points for select to authenticated using (public.can_read_lesson(lesson_id));
create policy route_insert on public.route_points for insert to authenticated with check (
  public.is_instructor() and exists(select 1 from public.lessons l where l.id=lesson_id
    and l.status in ('active','completed') and recorded_at >= l.started_at
    and recorded_at <= coalesce(l.ended_at,now()+interval '30 seconds'))
);
create policy resource_read on public.resources for select to authenticated using (public.can_read_resource(id));
create policy resource_insert on public.resources for insert to authenticated with check (public.is_instructor());
create policy attachment_read on public.lesson_resources for select to authenticated using (public.can_read_lesson(lesson_id));
create policy attachment_insert on public.lesson_resources for insert to authenticated with check (public.is_instructor());

create function public.book_lesson(
  p_pupil_id uuid,p_starts_at timestamptz,p_ends_at timestamptz,p_pickup jsonb,p_dropoff jsonb,
  p_fee numeric,p_objectives text,p_before integer,p_after integer,p_source text,p_previous uuid,p_next uuid,p_inherited boolean default true
) returns uuid language plpgsql security definer set search_path='' as $$
declare previous_lesson public.lessons; next_lesson public.lessons; new_id uuid; place jsonb;
begin
  if not public.is_instructor() then raise exception 'Instructor access required'; end if;
  perform pg_advisory_xact_lock(9123041);
  if p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at or p_ends_at-p_starts_at>interval '8 hours' then raise exception 'Invalid lesson times'; end if;
  if p_before is null or p_after is null or p_before not between 0 and 480 or p_after not between 0 and 480 or p_source not in ('automatic','manual') then raise exception 'Invalid travel allowance'; end if;
  foreach place in array array[p_pickup,p_dropoff] loop
    if place is null or coalesce(length(trim(place->>'label')),0)=0 or (place->>'lat') is null or (place->>'lng') is null
      or (place->>'lat')::float8 not between -90 and 90 or (place->>'lng')::float8 not between -180 and 180 then raise exception 'Select pickup and drop-off locations'; end if;
  end loop;
  select * into previous_lesson from public.lessons where status<>'cancelled' and ends_at<=p_starts_at order by ends_at desc limit 1;
  select * into next_lesson from public.lessons where status<>'cancelled' and starts_at>=p_ends_at order by starts_at limit 1;
  if previous_lesson.id is distinct from p_previous or next_lesson.id is distinct from p_next then raise exception 'The diary has changed. Check availability again.'; end if;
  if previous_lesson.id is not null and p_starts_at < previous_lesson.ends_at+make_interval(mins=>p_before) then raise exception 'Insufficient travel time from previous lesson'; end if;
  if next_lesson.id is not null and next_lesson.starts_at < p_ends_at+make_interval(mins=>p_after) then raise exception 'Insufficient travel time to next lesson'; end if;
  insert into public.lessons(pupil_id,starts_at,ends_at,pickup,dropoff,fee,objectives,objectives_inherited,travel_before_minutes,travel_source)
    values(p_pupil_id,p_starts_at,p_ends_at,p_pickup,p_dropoff,p_fee,coalesce(p_objectives,''),p_inherited,case when previous_lesson.id is null then 0 else p_before end,p_source) returning id into new_id;
  if next_lesson.id is not null then update public.lessons set travel_before_minutes=p_after,travel_source=p_source where id=next_lesson.id; end if;
  return new_id;
end;
$$;
create function public.save_lesson_notes(p_id uuid,p_notes jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_instructor() then raise exception 'Instructor access required'; end if;
  if length(p_notes::text)>110000 then raise exception 'Notes are too long'; end if;
  update public.lessons set objectives_inherited=objectives_inherited and objectives=coalesce(p_notes->>'objectives',''),
    objectives=coalesce(p_notes->>'objectives',''),improved=coalesce(p_notes->>'improved',''),
    needs_work=coalesce(p_notes->>'needs_work',''),other=coalesce(p_notes->>'other',''),next_aims=coalesce(p_notes->>'next_aims','') where id=p_id;
  if not found then raise exception 'Lesson not found'; end if;
end;
$$;
create function public.set_lesson_paid(p_id uuid,p_paid boolean) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_instructor() then raise exception 'Instructor access required'; end if;
  update public.lessons set paid=p_paid where id=p_id;
  if not found then raise exception 'Lesson not found'; end if;
end;
$$;
create function public.start_lesson(p_id uuid,p_mileage numeric) returns void language plpgsql security definer set search_path='' as $$
declare l public.lessons; aims text;
begin
  if not public.is_instructor() then raise exception 'Instructor access required'; end if;
  perform pg_advisory_xact_lock(9123041);
  select * into l from public.lessons where id=p_id for update;
  if not found or l.status<>'scheduled' then raise exception 'Only a scheduled lesson can be started'; end if;
  if p_mileage is null or p_mileage<0 then raise exception 'Enter starting mileage'; end if;
  if exists(select 1 from public.lessons where status='active') then raise exception 'Another lesson is already active'; end if;
  select next_aims into aims from public.lessons where pupil_id=l.pupil_id and status='completed' and starts_at<l.starts_at order by starts_at desc limit 1;
  update public.lessons set status='active',started_at=clock_timestamp(),start_mileage=p_mileage,
    objectives=case when objectives_inherited and aims is not null then aims else objectives end where id=p_id;
end;
$$;
create function public.finish_lesson(p_id uuid,p_mileage numeric) returns void language plpgsql security definer set search_path='' as $$
declare l public.lessons;
begin
  if not public.is_instructor() then raise exception 'Instructor access required'; end if;
  select * into l from public.lessons where id=p_id for update;
  if not found or l.status<>'active' then raise exception 'Only an active lesson can be stopped'; end if;
  if p_mileage is null or p_mileage<l.start_mileage then raise exception 'Ending mileage must be at least the starting mileage'; end if;
  update public.lessons set status='completed',ended_at=clock_timestamp(),end_mileage=p_mileage where id=p_id;
end;
$$;
create function public.cancel_lesson(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare l public.lessons;
begin
  if not public.is_instructor() then raise exception 'Instructor access required'; end if;
  perform pg_advisory_xact_lock(9123041);
  select * into l from public.lessons where id=p_id for update;
  if not found or l.status<>'scheduled' then raise exception 'Only a scheduled lesson can be cancelled'; end if;
  update public.lessons set status='cancelled' where id=p_id;
  update public.lessons set travel_source='review' where id=(select id from public.lessons where status<>'cancelled' and starts_at>=l.ends_at order by starts_at limit 1);
end;
$$;
create function public.update_travel_allowance(p_id uuid,p_previous uuid,p_minutes integer,p_source text) returns void language plpgsql security definer set search_path='' as $$
declare l public.lessons; previous_lesson public.lessons;
begin
  if not public.is_instructor() then raise exception 'Instructor access required'; end if;
  perform pg_advisory_xact_lock(9123041);
  select * into l from public.lessons where id=p_id;
  if not found or l.status='cancelled' then raise exception 'Lesson unavailable'; end if;
  if p_minutes is null or p_minutes not between 0 and 480 or p_source not in ('automatic','manual') then raise exception 'Invalid allowance'; end if;
  select * into previous_lesson from public.lessons where status<>'cancelled' and id<>p_id and ends_at<=l.starts_at order by ends_at desc limit 1;
  if previous_lesson.id is distinct from p_previous then raise exception 'The diary changed. Try again.'; end if;
  if previous_lesson.id is not null and l.starts_at<previous_lesson.ends_at+make_interval(mins=>p_minutes) then raise exception 'Insufficient travel time. Rebook with enough time.'; end if;
  update public.lessons set travel_before_minutes=case when previous_lesson.id is null then 0 else p_minutes end,travel_source=p_source where id=p_id;
end;
$$;
create function public.import_lesson_route(p_id uuid,p_points jsonb) returns void language plpgsql security definer set search_path='' as $$
declare l public.lessons;
begin
  if not public.is_instructor() then raise exception 'Instructor access required'; end if;
  select * into l from public.lessons where id=p_id for update;
  if not found or l.status<>'completed' then raise exception 'Complete the lesson before importing a route'; end if;
  if jsonb_typeof(p_points)<>'array' or jsonb_array_length(p_points)>30000 then raise exception 'Invalid route'; end if;
  if exists(select 1 from jsonb_to_recordset(p_points) as p(lat float8,lng float8,recorded_at timestamptz)
    where p.recorded_at is null or p.recorded_at<l.started_at or p.recorded_at>l.ended_at) then raise exception 'Route points must fall within the lesson'; end if;
  insert into public.route_points(lesson_id,lat,lng,accuracy,recorded_at)
    select p_id,p.lat,p.lng,0,p.recorded_at from jsonb_to_recordset(p_points) as p(lat float8,lng float8,recorded_at timestamptz)
    on conflict (lesson_id,recorded_at,lat,lng) do nothing;
end;
$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('teaching-resources','teaching-resources',false,52428800,array['image/png','image/jpeg','image/webp','video/mp4','video/webm','video/quicktime']);
create policy teaching_files_read on storage.objects for select to authenticated using (
  bucket_id='teaching-resources' and (public.is_instructor() or exists(select 1 from public.resources r where r.storage_path=name and public.can_read_resource(r.id)))
);
create policy teaching_files_insert on storage.objects for insert to authenticated with check (bucket_id='teaching-resources' and public.is_instructor());
create policy teaching_files_delete on storage.objects for delete to authenticated using (bucket_id='teaching-resources' and public.is_instructor());

-- SECURITY DEFINER functions must not retain PostgreSQL's default PUBLIC execute grant.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('is_instructor','can_read_lesson','can_read_resource','claim_pupil_account','book_lesson','save_lesson_notes','set_lesson_paid','start_lesson','finish_lesson','cancel_lesson','import_lesson_route','update_travel_allowance') loop
    execute format('revoke all on function %s from public, anon',f.signature);
    execute format('grant execute on function %s to authenticated',f.signature);
  end loop;
end $$;
commit;
