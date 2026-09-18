begin;
create function public.detail_skill_count(p_category integer) returns integer language sql immutable set search_path='' as $$
 select (array[16,23,14,13,37,20,14,19,17,21,25,16,21,15,11,18,16,21,30,22,24,18,19,13,11,22,21,25,17,21,16,14,14,13,15,12])[p_category];
$$;
create function public.detail_skill_title(p_category integer) returns text language sql immutable set search_path='' as $$
 select (array['Legal responsibilities & driver fitness','Vehicle safety checks / Show Me, Tell Me','Cockpit drill','Vehicle security','Controls & instruments','Moving off','Normal stopping','Road position & safety margins','Mirrors & observation','Signals','Anticipation & awareness','Planning & decision-making','Use of speed','Meeting traffic','Crossing traffic','Overtaking & passing','Junctions - general','Junctions - types & situations','Roundabouts','Pedestrian crossings & vulnerable road users','Traffic lights, signs & road markings','Reversing - general control','Parking & manoeuvres','Turning the vehicle around','Emergency stop','Rural & country roads','Dual carriageways','Motorways','Driving in darkness','Adverse weather & conditions','Passengers & loads','Eco-driving & mechanical sympathy','Independent driving','Motorway/navigation technology & driver aids','Driving independently under pressure','Self-evaluation & reflective driving'])[p_category];
$$;
create table public.pupil_detail_ratings (
 id uuid primary key default gen_random_uuid(),
 pupil_id uuid not null references public.pupils(id) on delete cascade,
 category_id integer not null check(category_id between 1 and 36),
 item_id integer not null check(item_id>=1 and item_id<=public.detail_skill_count(category_id)),
 rating integer not null check(rating between 0 and 4),
 updated_at timestamptz not null default now(),
 unique(pupil_id,category_id,item_id)
);
alter table public.pupil_detail_ratings enable row level security;
revoke all on public.pupil_detail_ratings from public,anon,authenticated;
grant select on public.pupil_detail_ratings to authenticated;
create policy detail_rating_read on public.pupil_detail_ratings for select to authenticated using(
 public.is_instructor() or exists(select 1 from public.pupils p where p.id=pupil_id and p.user_id=auth.uid())
);
create function public.set_pupil_detail_rating(p_pupil_id uuid,p_category_id integer,p_item_id integer,p_rating integer,p_expected integer)
returns public.pupil_detail_ratings language plpgsql security definer set search_path='' as $$
declare old_rating integer; result public.pupil_detail_ratings;
begin
 if not public.is_instructor() then raise exception 'Instructor access required'; end if;
 if p_category_id is null or p_category_id not between 1 and 36 or p_item_id is null or p_item_id<1 or p_item_id>public.detail_skill_count(p_category_id) or p_rating is null or p_rating not between 0 and 4 or p_expected is null or p_expected not between 0 and 4 then raise exception 'Invalid skill or rating'; end if;
 perform 1 from public.pupils where id=p_pupil_id for update;
 if not found then raise exception 'Pupil not found'; end if;
 select rating into old_rating from public.pupil_detail_ratings where pupil_id=p_pupil_id and category_id=p_category_id and item_id=p_item_id;
 if coalesce(old_rating,0)<>p_expected then raise exception 'This rating has changed. Refresh the skill list and try again.'; end if;
 insert into public.pupil_detail_ratings(pupil_id,category_id,item_id,rating) values(p_pupil_id,p_category_id,p_item_id,p_rating)
 on conflict(pupil_id,category_id,item_id) do update set rating=excluded.rating,updated_at=now() returning * into result;
 return result;
end;
$$;
create table public.lesson_skill_pins (
 id uuid primary key default gen_random_uuid(),
 lesson_id uuid not null references public.lessons(id) on delete cascade,
 category_id integer not null check(category_id between 1 and 36),
 title text not null,
 points integer not null check(points>=0),
 item_count integer not null check(item_count>0),
 captured_at timestamptz not null default now(),
 pinned boolean not null default true,
 unique(lesson_id,category_id),
 check(points<=item_count*4)
);
alter table public.lesson_skill_pins enable row level security;
revoke all on public.lesson_skill_pins from public,anon,authenticated;
grant select on public.lesson_skill_pins to authenticated;
create policy lesson_skill_pin_read on public.lesson_skill_pins for select to authenticated using(
 public.is_instructor() or (pinned and public.can_read_lesson(lesson_id))
);
create function public.pin_lesson_skill(p_lesson_id uuid,p_category_id integer,p_refresh boolean default false)
returns public.lesson_skill_pins language plpgsql security definer set search_path='' as $$
declare pupil_key uuid; score integer; result public.lesson_skill_pins;
begin
 if not public.is_instructor() then raise exception 'Instructor access required'; end if;
 if p_category_id is null or p_category_id not between 1 and 36 then raise exception 'Invalid core skill'; end if;
 select pupil_id into pupil_key from public.lessons where id=p_lesson_id and status<>'cancelled' for update;
 if pupil_key is null then raise exception 'Lesson unavailable'; end if;
 perform 1 from public.pupils where id=pupil_key for update;
 select coalesce(sum(rating),0) into score from public.pupil_detail_ratings where pupil_id=pupil_key and category_id=p_category_id;
 insert into public.lesson_skill_pins(lesson_id,category_id,title,points,item_count)
 values(p_lesson_id,p_category_id,public.detail_skill_title(p_category_id),score,public.detail_skill_count(p_category_id))
 on conflict(lesson_id,category_id) do update set
 title=case when p_refresh or not public.lesson_skill_pins.pinned then excluded.title else public.lesson_skill_pins.title end,
 points=case when p_refresh or not public.lesson_skill_pins.pinned then excluded.points else public.lesson_skill_pins.points end,
 item_count=case when p_refresh or not public.lesson_skill_pins.pinned then excluded.item_count else public.lesson_skill_pins.item_count end,
 captured_at=case when p_refresh or not public.lesson_skill_pins.pinned then now() else public.lesson_skill_pins.captured_at end,
 pinned=true returning * into result;
 return result;
end;
$$;
create function public.unpin_lesson_skill(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_instructor() then raise exception 'Instructor access required'; end if;
 update public.lesson_skill_pins set pinned=false where id=p_id;
 if not found then raise exception 'Pinned skill unavailable'; end if;
end;
$$;
revoke all on function public.detail_skill_count(integer),public.detail_skill_title(integer),public.set_pupil_detail_rating(uuid,integer,integer,integer,integer),public.pin_lesson_skill(uuid,integer,boolean),public.unpin_lesson_skill(uuid) from public,anon;
grant execute on function public.detail_skill_count(integer),public.detail_skill_title(integer),public.set_pupil_detail_rating(uuid,integer,integer,integer,integer),public.pin_lesson_skill(uuid,integer,boolean),public.unpin_lesson_skill(uuid) to authenticated;
commit;
