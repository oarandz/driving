begin;
create table public.pupil_skill_ratings (
 id uuid primary key default gen_random_uuid(),
 pupil_id uuid not null references public.pupils(id) on delete cascade,
 skill_id integer not null check(skill_id between 1 and 27),
 rating integer not null check(rating between 0 and 4),
 updated_at timestamptz not null default now(),
 unique(pupil_id,skill_id)
);
alter table public.pupil_skill_ratings enable row level security;
revoke all on public.pupil_skill_ratings from public,anon,authenticated;
grant select on public.pupil_skill_ratings to authenticated;
create policy pupil_skills_read on public.pupil_skill_ratings for select to authenticated using (
 public.is_instructor() or exists(select 1 from public.pupils p where p.id=pupil_id and p.user_id=auth.uid())
);
create function public.set_pupil_skill(p_pupil_id uuid,p_skill_id integer,p_rating integer,p_expected integer)
returns public.pupil_skill_ratings language plpgsql security definer set search_path='' as $$
declare current_rating integer; result public.pupil_skill_ratings;
begin
 if not public.is_instructor() then raise exception 'Instructor access required'; end if;
 if p_skill_id is null or p_skill_id not between 1 and 27 or p_rating is null or p_rating not between 0 and 4 or p_expected is null or p_expected not between 0 and 4 then raise exception 'Invalid skill or rating'; end if;
 perform 1 from public.pupils where id=p_pupil_id for update;
 if not found then raise exception 'Pupil not found'; end if;
 select rating into current_rating from public.pupil_skill_ratings where pupil_id=p_pupil_id and skill_id=p_skill_id;
 if coalesce(current_rating,0)<>p_expected then raise exception 'This rating has changed. Reopen the skill list and try again.'; end if;
 insert into public.pupil_skill_ratings(pupil_id,skill_id,rating) values(p_pupil_id,p_skill_id,p_rating)
 on conflict(pupil_id,skill_id) do update set rating=excluded.rating,updated_at=now() returning * into result;
 return result;
end;
$$;
create table public.pupil_activity (
 id uuid primary key default gen_random_uuid(),
 pupil_id uuid not null unique references public.pupils(id) on delete cascade,
 sign_in_count bigint not null default 0,
 visit_count bigint not null default 0,
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 last_sign_in_at timestamptz
);
create table public.pupil_activity_sessions (
 pupil_id uuid not null references public.pupils(id) on delete cascade,
 session_id uuid not null,
 first_seen_at timestamptz not null default now(),
 primary key(pupil_id,session_id)
);
alter table public.pupil_activity enable row level security;
alter table public.pupil_activity_sessions enable row level security;
revoke all on public.pupil_activity,public.pupil_activity_sessions from public,anon,authenticated;
grant select on public.pupil_activity to authenticated;
create policy activity_instructor_read on public.pupil_activity for select to authenticated using(public.is_instructor());
create function public.record_pupil_activity() returns void language plpgsql security definer set search_path='' as $$
declare target uuid; session_key uuid; new_session integer; last_seen timestamptz; stamp timestamptz:=now();
begin
 -- Derive the pupil and session from the signed-in account, never client arguments.
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if public.is_instructor() then return; end if;
 select id into target from public.pupils where user_id=auth.uid() for update;
 if target is null then raise exception 'Pupil account not linked'; end if;
 session_key:=nullif(auth.jwt()->>'session_id','')::uuid;
 if session_key is null then raise exception 'Sign in again to record activity'; end if;
 insert into public.pupil_activity_sessions(pupil_id,session_id) values(target,session_key) on conflict do nothing;
 get diagnostics new_session=row_count;
 select last_seen_at into last_seen from public.pupil_activity where pupil_id=target;
 insert into public.pupil_activity(pupil_id,sign_in_count,visit_count,first_seen_at,last_seen_at,last_sign_in_at)
 values(target,new_session,1,stamp,stamp,case when new_session=1 then stamp end)
 on conflict(pupil_id) do update set
 sign_in_count=public.pupil_activity.sign_in_count+new_session,
 visit_count=public.pupil_activity.visit_count+case when new_session=1 or last_seen<=stamp-interval '30 minutes' then 1 else 0 end,
 last_seen_at=stamp,
 last_sign_in_at=case when new_session=1 then stamp else public.pupil_activity.last_sign_in_at end;
end;
$$;
revoke all on function public.set_pupil_skill(uuid,integer,integer,integer),public.record_pupil_activity() from public,anon;
grant execute on function public.set_pupil_skill(uuid,integer,integer,integer),public.record_pupil_activity() to authenticated;
commit;
