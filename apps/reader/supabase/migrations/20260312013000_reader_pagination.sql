create index if not exists feeds_folder_idx
  on public.feeds (folder);

create index if not exists articles_published_cursor_idx
  on public.articles (published_at desc, id desc);

create index if not exists articles_saved_cursor_idx
  on public.articles (published_at desc, id desc)
  where is_saved = true;

create or replace function public.reader_sidebar_counts(p_tz_offset_minutes integer default 0)
returns jsonb
language sql
stable
as $$
  with bounds as (
    select
      date_trunc('day', now() - make_interval(mins => p_tz_offset_minutes)) +
      make_interval(mins => p_tz_offset_minutes) as start_at
  ),
  totals as (
    select
      count(*)::integer as all_count,
      count(*) filter (where a.is_saved)::integer as saved_count,
      count(*) filter (
        where a.published_at >= b.start_at
          and a.published_at < b.start_at + interval '1 day'
      )::integer as today_count
    from public.articles a
    cross join bounds b
  ),
  folder_totals as (
    select coalesce(
      jsonb_object_agg(folder, article_count order by folder),
      '{}'::jsonb
    ) as folders
    from (
      select
        f.folder,
        count(*)::integer as article_count
      from public.articles a
      join public.feeds f
        on f.id = a.feed_id
      group by f.folder
    ) counts
  )
  select jsonb_build_object(
    'all', totals.all_count,
    'saved', totals.saved_count,
    'today', totals.today_count,
    'folders', folder_totals.folders
  )
  from totals, folder_totals;
$$;

create or replace function public.reader_article_page(
  p_scope text default 'all',
  p_folder text default '',
  p_tz_offset_minutes integer default 0,
  p_limit integer default 51,
  p_before_published_at timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  feed_id uuid,
  title text,
  url text,
  author text,
  published_at timestamptz,
  summary_html text,
  read_time_minutes integer,
  is_read boolean,
  is_saved boolean,
  feed_title text,
  feed_folder text,
  feed_site_url text,
  feed_icon_url text
)
language sql
stable
as $$
  with bounds as (
    select
      date_trunc('day', now() - make_interval(mins => p_tz_offset_minutes)) +
      make_interval(mins => p_tz_offset_minutes) as start_at
  )
  select
    a.id,
    a.feed_id,
    a.title,
    a.url,
    a.author,
    a.published_at,
    a.summary_html,
    a.read_time_minutes,
    a.is_read,
    a.is_saved,
    f.title as feed_title,
    f.folder as feed_folder,
    f.site_url as feed_site_url,
    f.icon_url as feed_icon_url
  from public.articles a
  join public.feeds f
    on f.id = a.feed_id
  cross join bounds b
  where (p_folder = '' or f.folder = p_folder)
    and case
      when p_scope = 'saved' then a.is_saved
      when p_scope = 'today' then (
        a.published_at >= b.start_at and
        a.published_at < b.start_at + interval '1 day'
      )
      else true
    end
    and (
      p_before_published_at is null or
      a.published_at < p_before_published_at or
      (
        p_before_id is not null and
        a.published_at = p_before_published_at and
        a.id < p_before_id
      )
    )
  order by a.published_at desc, a.id desc
  limit least(greatest(p_limit, 1), 101);
$$;

create or replace function public.reader_mark_all_read(
  p_scope text default 'all',
  p_folder text default '',
  p_tz_offset_minutes integer default 0
)
returns integer
language plpgsql
as $$
declare
  v_start timestamptz;
  v_updated integer;
begin
  v_start := date_trunc('day', now() - make_interval(mins => p_tz_offset_minutes)) +
    make_interval(mins => p_tz_offset_minutes);

  update public.articles a
  set
    is_read = true,
    read_at = now()
  from public.feeds f
  where f.id = a.feed_id
    and a.is_read = false
    and (p_folder = '' or f.folder = p_folder)
    and case
      when p_scope = 'saved' then a.is_saved
      when p_scope = 'today' then (
        a.published_at >= v_start and
        a.published_at < v_start + interval '1 day'
      )
      else true
    end;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;
