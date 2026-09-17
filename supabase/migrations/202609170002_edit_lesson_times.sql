-- Edit bookings and recorded driving times without replacing notes, mileage or routes.
create or replace function public.edit_lesson_times(
 p_id uuid,p_starts_at timestamptz,p_ends_at timestamptz,p_started_at timestamptz,p_ended_at timestamptz,
 p_expected jsonb,p_before integer,p_after integer,p_previous uuid,p_next uuid
) returns void language plpgsql security definer set search_path='' as $$
declare l public.lessons; previous_lesson public.lessons; next_lesson public.lessons; old_next uuid; moved boolean;
begin
 if not public.is_instructor() then raise exception 'Instructor access required'; end if;
 perform pg_advisory_xact_lock(9123041);
 select * into l from public.lessons where id=p_id for update;
 if not found or l.status='cancelled' then raise exception 'Lesson unavailable'; end if;
 if p_expected is null or not (p_expected ?& array['starts_at','ends_at','started_at','ended_at','status'])
   or (p_expected->>'starts_at')::timestamptz is distinct from l.starts_at
   or (p_expected->>'ends_at')::timestamptz is distinct from l.ends_at
   or (p_expected->>'started_at')::timestamptz is distinct from l.started_at
   or (p_expected->>'ended_at')::timestamptz is distinct from l.ended_at
   or p_expected->>'status' is distinct from l.status then
   raise exception 'This lesson has changed. Reopen it before editing its times.';
 end if;
 if p_starts_at is null or p_ends_at is null or not isfinite(p_starts_at) or not isfinite(p_ends_at)
   or p_ends_at<=p_starts_at or p_ends_at-p_starts_at>interval '8 hours' then raise exception 'Invalid booked times (maximum 8 hours)'; end if;
 if (l.status='scheduled' and (p_started_at is not null or p_ended_at is not null))
   or (l.status='active' and (p_started_at is null or p_started_at>now() or p_ended_at is not null))
   or (l.status='completed' and (p_started_at is null or p_ended_at is null or p_ended_at<p_started_at))
   or (p_started_at is not null and not isfinite(p_started_at))
   or (p_ended_at is not null and not isfinite(p_ended_at)) then raise exception 'Invalid recorded driving times'; end if;
 moved:=p_starts_at<>l.starts_at or p_ends_at<>l.ends_at;
 if moved then
   if p_before is null or p_after is null or p_before not between 0 and 480 or p_after not between 0 and 480 then raise exception 'Invalid travel allowance'; end if;
   if exists(select 1 from public.lessons where id<>p_id and status<>'cancelled' and starts_at<p_ends_at and ends_at>p_starts_at) then raise exception 'This overlaps another lesson. Choose a different time.'; end if;
   select id into old_next from public.lessons where id<>p_id and status<>'cancelled' and starts_at>=l.ends_at order by starts_at limit 1;
   select * into previous_lesson from public.lessons where id<>p_id and status<>'cancelled' and ends_at<=p_starts_at order by ends_at desc limit 1;
   select * into next_lesson from public.lessons where id<>p_id and status<>'cancelled' and starts_at>=p_ends_at order by starts_at limit 1;
   if previous_lesson.id is distinct from p_previous or next_lesson.id is distinct from p_next then raise exception 'The diary has changed. Check the times again.'; end if;
   if previous_lesson.id is not null and p_starts_at<previous_lesson.ends_at+make_interval(mins=>p_before) then raise exception 'Insufficient travel time from previous lesson'; end if;
   if next_lesson.id is not null and next_lesson.starts_at<p_ends_at+make_interval(mins=>p_after) then raise exception 'Insufficient travel time to next lesson'; end if;
   update public.lessons set travel_before_minutes=case when previous_lesson.id is null then 0 else p_before end,travel_source='manual' where id=p_id;
   if next_lesson.id is not null then update public.lessons set travel_before_minutes=p_after,travel_source='manual' where id=next_lesson.id; end if;
   if old_next is not null and old_next is distinct from next_lesson.id then update public.lessons set travel_source='review' where id=old_next; end if;
 end if;
 update public.lessons set starts_at=p_starts_at,ends_at=p_ends_at,started_at=p_started_at,ended_at=p_ended_at where id=p_id;
end;
$$;
revoke all on function public.edit_lesson_times(uuid,timestamptz,timestamptz,timestamptz,timestamptz,jsonb,integer,integer,uuid,uuid) from public,anon;
grant execute on function public.edit_lesson_times(uuid,timestamptz,timestamptz,timestamptz,timestamptz,jsonb,integer,integer,uuid,uuid) to authenticated;
