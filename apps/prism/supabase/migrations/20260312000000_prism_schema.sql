create table if not exists public.prism_sessions (
  id uuid primary key,
  title text not null,
  initial_idea text not null default '',
  spec_content text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  clarification_round integer not null default 0,
  readiness integer not null default 0,
  structure_score integer not null default 0,
  ambiguity_label text not null default 'High' check (ambiguity_label in ('Low', 'Medium', 'High')),
  warnings_count integer not null default 0,
  open_questions_count integer not null default 0,
  overall_score integer not null default 0,
  ambiguity_score double precision not null default 1,
  goal_clarity double precision not null default 0,
  constraint_clarity double precision not null default 0,
  success_criteria_clarity double precision not null default 0,
  goal_justification text not null default '',
  constraint_justification text not null default '',
  success_criteria_justification text not null default '',
  is_ready boolean not null default false,
  pending_question_text text,
  pending_question_choices jsonb,
  pending_question_dimension text check (pending_question_dimension in ('goal', 'constraints', 'success_criteria', 'context')),
  pending_question_round integer,
  reconciliation_status text not null default 'idle' check (reconciliation_status in ('idle', 'pending', 'running')),
  reconciled_round integer not null default 0
);

create table if not exists public.prism_transcript_entries (
  id uuid primary key,
  session_id uuid not null references public.prism_sessions(id) on delete cascade,
  role text not null check (role in ('assistant', 'user')),
  entry_type text not null check (entry_type in ('question', 'answer')),
  content text not null,
  choices jsonb not null default '[]'::jsonb,
  selected_choice_key text,
  selected_choice_label text,
  target_dimension text check (target_dimension in ('goal', 'constraints', 'success_criteria', 'context')),
  round_number integer not null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.prism_market_reports (
  session_id uuid primary key references public.prism_sessions(id) on delete cascade,
  status text not null default 'idle' check (status in ('idle', 'pending', 'running', 'completed', 'failed')),
  markdown_content text not null default '',
  citations_json jsonb not null default '[]'::jsonb,
  query_plan_json jsonb not null default '[]'::jsonb,
  spec_snapshot text not null default '',
  generated_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now()),
  error_message text
);

create index if not exists idx_prism_sessions_updated_at
  on public.prism_sessions (updated_at desc, created_at desc);

create index if not exists idx_prism_transcript_entries_session_round
  on public.prism_transcript_entries (session_id, round_number, created_at);

create index if not exists idx_prism_market_reports_updated_at
  on public.prism_market_reports (updated_at desc);

alter table public.prism_sessions enable row level security;
alter table public.prism_transcript_entries enable row level security;
alter table public.prism_market_reports enable row level security;
