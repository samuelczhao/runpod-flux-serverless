create type public.dream_status as enum (
  'DRAFT', 'UPLOADED', 'TRANSCRIBING', 'PLANNING',
  'GENERATING_ANCHOR', 'GENERATING_SCENES', 'READY', 'FAILED', 'DELETING'
);

create type public.job_status as enum (
  'PENDING', 'SUBMITTING', 'SUBMIT_UNKNOWN', 'QUEUED', 'RUNNING',
  'COMPLETED', 'FAILED', 'CANCELLED'
);

create type public.motif_kind as enum ('person', 'place', 'object', 'emotion', 'theme');

create table public.dreams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status public.dream_status not null default 'DRAFT',
  input_mode text not null check (input_mode in ('audio', 'text')),
  transcript text check (char_length(transcript) <= 12000),
  title text check (char_length(title) <= 120),
  summary text check (char_length(summary) <= 600),
  visual_bible jsonb,
  workflow_run_id text,
  failed_stage text,
  error_code text,
  retain_audio boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.scenes (
  id uuid primary key default gen_random_uuid(),
  dream_id uuid not null references public.dreams(id) on delete cascade,
  ordinal smallint not null check (ordinal between 1 and 3),
  caption text not null check (char_length(caption) <= 240),
  prompt text not null check (char_length(prompt) <= 2000),
  unique (dream_id, ordinal)
);

create table public.scene_versions (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes(id) on delete cascade,
  parent_version_id uuid references public.scene_versions(id) on delete restrict,
  storage_path text,
  edit_instruction text check (char_length(edit_instruction) <= 1000),
  seed bigint check (seed >= 0),
  model text not null,
  status public.job_status not null default 'PENDING',
  created_at timestamptz not null default now()
);

create table public.motifs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  canonical_label text not null check (char_length(canonical_label) <= 80),
  slug text not null check (char_length(slug) <= 80),
  kind public.motif_kind not null,
  unique (user_id, slug)
);

create table public.dream_motifs (
  dream_id uuid not null references public.dreams(id) on delete cascade,
  motif_id uuid not null references public.motifs(id) on delete cascade,
  primary key (dream_id, motif_id)
);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dream_id uuid not null references public.dreams(id) on delete cascade,
  scene_version_id uuid references public.scene_versions(id) on delete cascade,
  stage text not null,
  operation_key text not null,
  provider text not null default 'runpod',
  model text not null,
  external_job_id text,
  status public.job_status not null default 'PENDING',
  attempt smallint not null default 1 check (attempt between 1 and 3),
  delay_ms integer check (delay_ms >= 0),
  execution_ms integer check (execution_ms >= 0),
  cost_usd numeric(18, 8) check (cost_usd >= 0),
  cost_source text check (cost_source in ('provider', 'estimated', 'unavailable')),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index dreams_user_created_idx on public.dreams (user_id, created_at desc);
create index generation_jobs_dream_idx on public.generation_jobs (dream_id, created_at);
create unique index generation_jobs_operation_idx on public.generation_jobs (user_id, operation_key);
create unique index generation_jobs_external_idx on public.generation_jobs (external_job_id)
  where external_job_id is not null;

alter table public.dreams enable row level security;
alter table public.scenes enable row level security;
alter table public.scene_versions enable row level security;
alter table public.motifs enable row level security;
alter table public.dream_motifs enable row level security;
alter table public.generation_jobs enable row level security;

create policy dreams_owner_select on public.dreams for select using (user_id = auth.uid());
create policy dreams_owner_insert on public.dreams for insert with check (
  user_id = auth.uid() and status = 'DRAFT' and workflow_run_id is null
);
create policy motifs_owner_select on public.motifs for select using (user_id = auth.uid());
create policy jobs_owner_select on public.generation_jobs for select using (user_id = auth.uid());

create policy scenes_owner_select on public.scenes for select using (
  exists (select 1 from public.dreams d where d.id = dream_id and d.user_id = auth.uid())
);
create policy versions_owner_select on public.scene_versions for select using (
  exists (
    select 1 from public.scenes s join public.dreams d on d.id = s.dream_id
    where s.id = scene_id and d.user_id = auth.uid()
  )
);
create policy dream_motifs_owner_select on public.dream_motifs for select using (
  exists (select 1 from public.dreams d where d.id = dream_id and d.user_id = auth.uid())
);

insert into storage.buckets (id, name, public, file_size_limit)
values ('dream-audio', 'dream-audio', false, 10485760),
       ('dream-images', 'dream-images', false, 10000000);

create policy dream_storage_owner_select on storage.objects for select using (
  bucket_id in ('dream-audio', 'dream-images') and (storage.foldername(name))[1] = auth.uid()::text
);
create policy dream_storage_owner_insert on storage.objects for insert with check (
  bucket_id in ('dream-audio', 'dream-images') and (storage.foldername(name))[1] = auth.uid()::text
);
create policy dream_storage_owner_delete on storage.objects for delete using (
  bucket_id in ('dream-audio', 'dream-images') and (storage.foldername(name))[1] = auth.uid()::text
);
