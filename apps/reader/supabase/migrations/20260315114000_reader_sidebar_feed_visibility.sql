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
        count(a.id)::integer as article_count
      from public.feeds f
      left join public.articles a
        on a.feed_id = f.id
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
