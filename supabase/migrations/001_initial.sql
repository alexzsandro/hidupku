create extension if not exists "pgcrypto";

create type public.task_status as enum ('todo', 'in_progress', 'done');
create type public.task_kind as enum ('one_time', 'recurring');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  timezone text not null default 'Asia/Jakarta',
  daily_goal integer not null default 60 check (daily_goal between 1 and 100),
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 180),
  notes text,
  weight smallint not null default 1 check (weight between 1 and 3),
  kind public.task_kind not null default 'one_time',
  scheduled_date date,
  recurrence_days smallint[] not null default '{}',
  is_archived boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.task_occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  occurrence_date date not null,
  title text not null,
  notes text,
  weight smallint not null check (weight between 1 and 3),
  status public.task_status not null default 'todo',
  focus_rank smallint check (focus_rank between 1 and 3),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(task_id, occurrence_date)
);

create table public.daily_stats (
  user_id uuid not null references auth.users(id) on delete cascade,
  stat_date date not null,
  total_points integer not null default 0,
  completed_points integer not null default 0,
  xp_earned integer not null default 0,
  goal_reached boolean not null default false,
  primary key (user_id, stat_date)
);

alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.task_occurrences enable row level security;
alter table public.daily_stats enable row level security;

create policy "own profile" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "own tasks" on public.tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own occurrences" on public.task_occurrences for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own daily stats" on public.daily_stats for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, timezone)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)), coalesce(new.raw_user_meta_data->>'timezone', 'Asia/Jakarta'));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();
