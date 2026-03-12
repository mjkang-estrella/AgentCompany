alter table public.articles
  add column if not exists thumbnail_url text;

update public.articles
set thumbnail_url = coalesce(
  (regexp_match(coalesce(body_html, ''), '<img[^>]+src=["'']([^"''>]+)["'']', 'i'))[1],
  (regexp_match(coalesce(summary_html, ''), '<img[^>]+src=["'']([^"''>]+)["'']', 'i'))[1]
)
where thumbnail_url is null;

drop function if exists public.reader_article_page(text, text, integer, integer, timestamptz, uuid);

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
  thumbnail_url text,
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
    a.thumbnail_url,
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
