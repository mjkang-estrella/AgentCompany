create extension if not exists pg_net;
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.invoke_reader_sync_feeds()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  project_url text;
  function_api_key text;
begin
  select decrypted_secret
  into project_url
  from vault.decrypted_secrets
  where name = 'reader_project_url';

  select decrypted_secret
  into function_api_key
  from vault.decrypted_secrets
  where name = 'reader_function_api_key';

  if project_url is null or function_api_key is null then
    raise exception 'Vault secrets reader_project_url and reader_function_api_key must be set';
  end if;

  perform net.http_post(
    url := project_url || '/functions/v1/sync-feeds',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || function_api_key
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'reader-sync-feeds-every-15-min'
  ) then
    perform cron.unschedule('reader-sync-feeds-every-15-min');
  end if;
end;
$$;

select cron.schedule(
  'reader-sync-feeds-every-15-min',
  '*/15 * * * *',
  $$select public.invoke_reader_sync_feeds();$$
);
