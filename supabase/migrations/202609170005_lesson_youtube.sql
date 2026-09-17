begin;
create table public.lesson_videos (
 id uuid primary key default gen_random_uuid(),
 lesson_id uuid not null references public.lessons(id) on delete cascade,
 video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
 title text not null check (length(trim(title)) between 1 and 180),
 pinned boolean not null default true,
 created_at timestamptz not null default now(),
 unique (lesson_id,video_id)
);
alter table public.lesson_videos enable row level security;
revoke all on public.lesson_videos from public,anon,authenticated;
grant select on public.lesson_videos to authenticated;
create policy lesson_video_read on public.lesson_videos for select to authenticated using (
 public.is_instructor() or (pinned and public.can_read_lesson(lesson_id))
);
create function public.pin_lesson_video(p_lesson_id uuid,p_video_id text,p_title text)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not public.is_instructor() then raise exception 'Instructor access required'; end if;
 perform 1 from public.lessons where id=p_lesson_id and status<>'cancelled' for update;
 if not found then raise exception 'Lesson unavailable'; end if;
 if p_video_id is null or p_video_id !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'Invalid YouTube video'; end if;
 if p_title is null or length(trim(p_title)) not between 1 and 180 then raise exception 'Enter a video title (maximum 180 characters)'; end if;
 insert into public.lesson_videos(lesson_id,video_id,title) values(p_lesson_id,p_video_id,trim(p_title))
 on conflict(lesson_id,video_id) do update set title=excluded.title,pinned=true returning id into result;
 return result;
end;
$$;
create function public.unpin_lesson_video(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_instructor() then raise exception 'Instructor access required'; end if;
 update public.lesson_videos set pinned=false where id=p_id;
 if not found then raise exception 'Video not found'; end if;
end;
$$;
revoke all on function public.pin_lesson_video(uuid,text,text),public.unpin_lesson_video(uuid) from public,anon;
grant execute on function public.pin_lesson_video(uuid,text,text),public.unpin_lesson_video(uuid) to authenticated;
commit;
