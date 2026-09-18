begin;
-- Private instructor notes, separate from the pupil-visible lesson notes.
create table public.lesson_skill_reviews (
 id uuid primary key default gen_random_uuid(),
 lesson_id uuid not null unique references public.lessons(id) on delete cascade,
 summary text not null default '' check(length(summary)<=6000),
 updated_at timestamptz not null default now()
);
alter table public.lesson_skill_reviews enable row level security;
revoke all on public.lesson_skill_reviews from public,anon,authenticated;
grant select on public.lesson_skill_reviews to authenticated;
create policy instructor_review_read on public.lesson_skill_reviews for select to authenticated using(public.is_instructor());
create function public.save_lesson_skill_summary(p_lesson_id uuid,p_summary text,p_expected text)
returns public.lesson_skill_reviews language plpgsql security definer set search_path='' as $$
declare old_summary text; result public.lesson_skill_reviews;
begin
 if not public.is_instructor() then raise exception 'Instructor access required'; end if;
 if p_summary is null or length(p_summary)>6000 or p_expected is null then raise exception 'Summary must be at most 6000 characters'; end if;
 perform 1 from public.lessons where id=p_lesson_id and status<>'cancelled' for update;
 if not found then raise exception 'Lesson unavailable'; end if;
 select summary into old_summary from public.lesson_skill_reviews where lesson_id=p_lesson_id;
 if coalesce(old_summary,'')<>p_expected then raise exception 'This summary has changed elsewhere. Reload the page to load the saved version before editing.'; end if;
 insert into public.lesson_skill_reviews(lesson_id,summary) values(p_lesson_id,p_summary)
 on conflict(lesson_id) do update set summary=excluded.summary,updated_at=now() returning * into result;
 return result;
end;
$$;
create table public.lesson_detail_skill_pins (
 id uuid primary key default gen_random_uuid(),lesson_id uuid not null references public.lessons(id) on delete cascade,
 category_id integer not null check(category_id between 1 and 36),item_id integer not null check(item_id>=1 and item_id<=public.detail_skill_count(category_id)),
 title text not null check(length(title) between 1 and 250),rating integer not null check(rating between 0 and 4),
 captured_at timestamptz not null default now(),pinned boolean not null default true,unique(lesson_id,category_id,item_id)
);
alter table public.lesson_detail_skill_pins enable row level security;
revoke all on public.lesson_detail_skill_pins from public,anon,authenticated;
grant select on public.lesson_detail_skill_pins to authenticated;
create policy lesson_detail_pin_read on public.lesson_detail_skill_pins for select to authenticated using(public.is_instructor() or (pinned and public.can_read_lesson(lesson_id)));
create function public.pin_lesson_detail_skill(p_lesson_id uuid,p_category integer,p_item integer,p_title text,p_refresh boolean default false)
returns public.lesson_detail_skill_pins language plpgsql security definer set search_path='' as $$
declare pupil_key uuid; score integer; result public.lesson_detail_skill_pins;
begin
 if not public.is_instructor() then raise exception 'Instructor access required'; end if;
 if p_category is null or p_category not between 1 and 36 or p_item is null or p_item<1 or p_item>public.detail_skill_count(p_category) or p_title is null or length(trim(p_title)) not between 1 and 250 then raise exception 'Invalid skill'; end if;
 select pupil_id into pupil_key from public.lessons where id=p_lesson_id and status<>'cancelled' for update;
 if pupil_key is null then raise exception 'Lesson unavailable'; end if;
 perform 1 from public.pupils where id=pupil_key for update;
 select rating into score from public.pupil_detail_ratings where pupil_id=pupil_key and category_id=p_category and item_id=p_item;
 insert into public.lesson_detail_skill_pins(lesson_id,category_id,item_id,title,rating) values(p_lesson_id,p_category,p_item,trim(p_title),coalesce(score,0))
 on conflict(lesson_id,category_id,item_id) do update set
 rating=case when p_refresh or not public.lesson_detail_skill_pins.pinned then excluded.rating else public.lesson_detail_skill_pins.rating end,
 captured_at=case when p_refresh or not public.lesson_detail_skill_pins.pinned then now() else public.lesson_detail_skill_pins.captured_at end,pinned=true returning * into result;
 return result;
end;
$$;
create function public.unpin_lesson_detail_skill(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_instructor() then raise exception 'Instructor access required'; end if;
 update public.lesson_detail_skill_pins set pinned=false where id=p_id;
end;
$$;
revoke all on function public.pin_lesson_detail_skill(uuid,integer,integer,text,boolean),public.unpin_lesson_detail_skill(uuid) from public,anon;
grant execute on function public.pin_lesson_detail_skill(uuid,integer,integer,text,boolean),public.unpin_lesson_detail_skill(uuid) to authenticated;

-- One transaction: a stale or invalid rating rejects the whole batch.
create function public.apply_lesson_skill_ratings(p_lesson_id uuid,p_changes jsonb,p_pin_categories integer[] default '{}',p_pin_items jsonb default '[]')
returns jsonb language plpgsql security definer set search_path='' as $$
declare pupil_key uuid; change jsonb; seen text[]='{}'; key text; category integer; ratings jsonb='[]'; pins jsonb='[]'; saved public.pupil_detail_ratings; pin public.lesson_skill_pins; detail_pin public.lesson_detail_skill_pins; detail_pins jsonb='[]';
begin
 if not public.is_instructor() then raise exception 'Instructor access required'; end if;
 if p_changes is null or jsonb_typeof(p_changes)<>'array' then raise exception 'Invalid rating changes'; end if;
 if p_pin_items is null or jsonb_typeof(p_pin_items)<>'array' then raise exception 'Invalid skills to pin'; end if;
 if jsonb_array_length(p_pin_items)>80 then raise exception 'Too many skills to pin'; end if;
 if jsonb_array_length(p_changes)>80 or p_pin_categories is null or cardinality(p_pin_categories)>36 or (jsonb_array_length(p_changes)=0 and cardinality(p_pin_categories)=0 and jsonb_array_length(p_pin_items)=0) then raise exception 'Choose rating changes or skills to pin'; end if;
 if exists(select 1 from unnest(p_pin_categories) c where c is null or c not between 1 and 36) or cardinality(p_pin_categories)<>(select count(distinct c) from unnest(p_pin_categories) c) then raise exception 'Invalid skills to pin'; end if;
 select pupil_id into pupil_key from public.lessons where id=p_lesson_id and status<>'cancelled' for update;
 if pupil_key is null then raise exception 'Lesson unavailable'; end if;
 perform 1 from public.pupils where id=pupil_key for update;
 for change in select value from jsonb_array_elements(p_changes) loop
  if jsonb_typeof(change)<>'object' or not (change ?& array['category_id','item_id','rating','expected'])
    or jsonb_typeof(change->'category_id')<>'number' or jsonb_typeof(change->'item_id')<>'number'
    or jsonb_typeof(change->'rating')<>'number' or jsonb_typeof(change->'expected')<>'number'
    or (change->>'category_id')!~'^[0-9]+$' or (change->>'item_id')!~'^[0-9]+$'
    or (change->>'rating')!~'^[0-4]$' or (change->>'expected')!~'^[0-4]$'
  then raise exception 'Invalid rating changes'; end if;
  key=(change->>'category_id')||'.'||(change->>'item_id');
  if key=any(seen) then raise exception 'Duplicate skill'; end if;
  seen=array_append(seen,key);
  saved=public.set_pupil_detail_rating(pupil_key,(change->>'category_id')::integer,(change->>'item_id')::integer,(change->>'rating')::integer,(change->>'expected')::integer);
  ratings=ratings||jsonb_build_array(to_jsonb(saved));
 end loop;
 foreach category in array p_pin_categories loop
  pin=public.pin_lesson_skill(p_lesson_id,category,false);
  pins=pins||jsonb_build_array(to_jsonb(pin));
 end loop;
 seen='{}';
 for change in select value from jsonb_array_elements(p_pin_items) loop
  if jsonb_typeof(change)<>'object' or not(change ?& array['category_id','item_id','title'])
   or jsonb_typeof(change->'category_id')<>'number' or jsonb_typeof(change->'item_id')<>'number' or jsonb_typeof(change->'title')<>'string'
   or (change->>'category_id')!~'^[0-9]+$' or (change->>'item_id')!~'^[0-9]+$' then raise exception 'Invalid skills to pin'; end if;
  key=(change->>'category_id')||'.'||(change->>'item_id');
  if key=any(seen) then raise exception 'Duplicate skill to pin'; end if;
  seen=array_append(seen,key);
  detail_pin=public.pin_lesson_detail_skill(p_lesson_id,(change->>'category_id')::integer,(change->>'item_id')::integer,change->>'title',false);
  detail_pins=detail_pins||jsonb_build_array(to_jsonb(detail_pin));
 end loop;
 return jsonb_build_object('ratings',ratings,'pins',pins,'detail_pins',detail_pins);
end;
$$;
-- Shared across function instances; clients cannot alter counters.
create table public.instructor_ai_usage (
 user_id uuid primary key references auth.users(id) on delete cascade,
 usage_day date not null,
 request_count integer not null,
 last_requested_at timestamptz not null
);
alter table public.instructor_ai_usage enable row level security;
revoke all on public.instructor_ai_usage from public,anon,authenticated;
create function public.reserve_skill_suggestion(p_lesson_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare usage public.instructor_ai_usage; utc_day date=(now() at time zone 'UTC')::date;
begin
 if not public.is_instructor() then raise exception 'Instructor access required'; end if;
 perform 1 from public.lessons where id=p_lesson_id and status<>'cancelled';
 if not found then raise exception 'Lesson unavailable'; end if;
 insert into public.instructor_ai_usage values(auth.uid(),utc_day,0,'epoch') on conflict(user_id) do nothing;
 select * into usage from public.instructor_ai_usage where user_id=auth.uid() for update;
 if usage.last_requested_at>now()-interval '30 seconds' or (usage.usage_day=utc_day and usage.request_count>=100) then return false; end if;
 update public.instructor_ai_usage set usage_day=utc_day,request_count=case when usage.usage_day=utc_day then usage.request_count+1 else 1 end,last_requested_at=now() where user_id=auth.uid();
 return true;
end;
$$;
revoke all on function public.save_lesson_skill_summary(uuid,text,text),public.apply_lesson_skill_ratings(uuid,jsonb,integer[],jsonb),public.reserve_skill_suggestion(uuid) from public,anon;
grant execute on function public.save_lesson_skill_summary(uuid,text,text),public.apply_lesson_skill_ratings(uuid,jsonb,integer[],jsonb),public.reserve_skill_suggestion(uuid) to authenticated;
commit;
