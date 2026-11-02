-- Minimal function used by the GitHub Actions keep-alive workflow.
-- Touches no tables; it only makes the project register database activity.
create or replace function public.keepalive()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select 1;
$$;

revoke all on function public.keepalive() from public;
grant execute on function public.keepalive() to anon;
