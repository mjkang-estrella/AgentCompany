create extension if not exists pgcrypto;

create or replace function public.set_timestamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.feeds (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  site_url text,
  feed_url text not null unique,
  folder text not null,
  icon_url text,
  is_active boolean not null default true,
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  feed_id uuid not null references public.feeds(id) on delete cascade,
  external_id text not null,
  url text not null,
  title text not null,
  author text,
  published_at timestamptz not null,
  summary_html text,
  body_html text,
  body_source text not null check (body_source in ('feed', 'fetched')),
  read_time_minutes integer,
  is_read boolean not null default false,
  is_saved boolean not null default false,
  read_at timestamptz,
  saved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint articles_feed_external_id_key unique (feed_id, external_id)
);

create index if not exists articles_published_at_idx
  on public.articles (published_at desc);

create index if not exists articles_feed_published_at_idx
  on public.articles (feed_id, published_at desc);

create index if not exists articles_saved_published_at_idx
  on public.articles (is_saved, published_at desc);

drop trigger if exists feeds_set_timestamp on public.feeds;
create trigger feeds_set_timestamp
before update on public.feeds
for each row
execute function public.set_timestamp();

drop trigger if exists articles_set_timestamp on public.articles;
create trigger articles_set_timestamp
before update on public.articles
for each row
execute function public.set_timestamp();

alter table public.feeds enable row level security;
alter table public.articles enable row level security;
