begin;
alter table public.pupils add column if not exists access_issued_at timestamptz;
grant select (id,email,user_id,access_issued_at) on public.pupils to service_role;
grant select (user_id) on public.instructors to service_role;
-- Email is a contact/login identifier, separate from the private Auth identity.
create or replace function public.edit_pupil_email(p_id uuid,p_email text,p_expected_email text)
returns void language plpgsql security definer set search_path='' as $$
declare p public.pupils; v_email text:=lower(trim(p_email));
begin
 if not public.is_instructor() then raise exception 'Instructor access required'; end if;
 select * into p from public.pupils where id=p_id for update;
 if not found then raise exception 'Pupil not found'; end if;
 if p.email is distinct from p_expected_email then raise exception 'This pupil has changed. Reopen their details.'; end if;
 if v_email is null or length(v_email)>320 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Enter a valid email address'; end if;
 if exists(select 1 from public.pupils where id<>p_id and lower(trim(pupils.email))=v_email) then raise exception 'That email is already assigned to another pupil'; end if;
 update public.pupils set email=v_email where id=p_id;
end;
$$;
revoke all on function public.edit_pupil_email(uuid,text,text) from public,anon;
grant execute on function public.edit_pupil_email(uuid,text,text) to authenticated;
-- New accounts are linked explicitly by the instructor. Existing links are preserved.
create or replace function public.claim_pupil_account() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
end;
$$;
create table public.pupil_code_attempts (
 key text primary key,
 window_start timestamptz not null,
 attempts integer not null
);
alter table public.pupil_code_attempts enable row level security;
revoke all on public.pupil_code_attempts from public,anon,authenticated;
create or replace function public.allow_pupil_code_attempt(p_key text) returns boolean language plpgsql security definer set search_path='' as $$
declare count integer;
begin
 if p_key is null or p_key !~ '^[a-f0-9]{64}$' then raise exception 'Invalid request'; end if;
 delete from public.pupil_code_attempts where window_start<now()-interval '1 hour';
 insert into public.pupil_code_attempts as a(key,window_start,attempts) values(p_key,now(),1)
 on conflict(key) do update set
  attempts=case when a.window_start<now()-interval '15 minutes' then 1 else a.attempts+1 end,
  window_start=case when a.window_start<now()-interval '15 minutes' then now() else a.window_start end
 returning attempts into count;
 return count<=8;
end;
$$;
revoke all on function public.allow_pupil_code_attempt(text) from public,anon,authenticated;
grant execute on function public.allow_pupil_code_attempt(text) to service_role;
create or replace function public.activate_pupil_code(p_id uuid,p_user_id uuid,p_expected_user uuid,p_expected_email text)
returns void language plpgsql security definer set search_path='' as $$
declare p public.pupils;
begin
 select * into p from public.pupils where id=p_id for update;
 if not found then raise exception 'Pupil not found'; end if;
 if p.user_id is distinct from p_expected_user or p.email is distinct from p_expected_email then raise exception 'Pupil details changed. Reopen and generate a new code.'; end if;
 if exists(select 1 from public.instructors where user_id=p_user_id or user_id=p.user_id) then raise exception 'Instructor accounts cannot be managed as pupils'; end if;
 if not exists(select 1 from auth.users where id=p_user_id and raw_app_meta_data->>'pupil_id'=p_id::text and raw_app_meta_data->>'managed_pupil'='true') then raise exception 'Invalid pupil identity'; end if;
 update public.pupils set user_id=p_user_id,access_issued_at=clock_timestamp() where id=p_id;
end;
$$;
revoke all on function public.activate_pupil_code(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.activate_pupil_code(uuid,uuid,uuid,text) to service_role;
commit;
