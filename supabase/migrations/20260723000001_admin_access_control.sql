-- 20260723000001_admin_access_control — サインアップ制御 + ユーザー権限（M5-06）
--
-- 1. app_settings: アプリ全体設定（単一行）。signup_enabled で新規登録の公開/停止を制御
-- 2. user_profiles: ユーザーごとのrole（admin/user）と機能フラグ（can_upload/can_process/can_chat）
-- 3. auth.users トリガー: signup停止中は新規登録をDBレベルで拒否、登録時にプロフィール自動作成
--
-- 最初の管理者はSQLで昇格する（README「運用」参照）:
--   update user_profiles set role = 'admin'
--   where user_id = (select id from auth.users where email = '<your-email>');

-- ============================================================
-- app_settings（単一行テーブル）
-- ============================================================
create table app_settings (
  id int primary key default 1 check (id = 1),
  signup_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into app_settings (id, signup_enabled) values (1, true);

-- ============================================================
-- user_profiles
-- ============================================================
create table user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('admin', 'user')),
  can_upload boolean not null default true,
  can_process boolean not null default true,
  can_chat boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 既存ユーザーのバックフィル
insert into user_profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;

-- ============================================================
-- is_admin() — RLSポリシー・管理RPCから参照するヘルパー
-- security definer: user_profilesのRLSに再帰せず判定するため
-- ============================================================
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from user_profiles
    where user_id = auth.uid() and role = 'admin'
  );
$$;

revoke execute on function is_admin() from anon;

-- ============================================================
-- RLS
-- ============================================================
alter table app_settings enable row level security;
-- signup_enabled はログイン画面（anon）でも参照するため全員読み取り可
create policy "read settings" on app_settings for select using (true);
create policy "admin update settings" on app_settings for update
  using (is_admin()) with check (is_admin());

alter table user_profiles enable row level security;
create policy "own or admin read" on user_profiles for select
  using (user_id = auth.uid() or is_admin());
create policy "admin update profiles" on user_profiles for update
  using (is_admin()) with check (is_admin());
-- insert/deleteはポリシーなし（トリガー＝table owner経由のみ）

-- ============================================================
-- auth.users トリガー
-- ============================================================

-- signup停止中は新規ユーザー作成を拒否（フロントを迂回したAuth API直叩きもブロック）
create or replace function public.enforce_signup_mode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (select signup_enabled from app_settings where id = 1) then
    raise exception 'signup_disabled';
  end if;
  return new;
end;
$$;

create trigger before_auth_user_created
  before insert on auth.users
  for each row execute function public.enforce_signup_mode();

-- 新規ユーザーのプロフィール自動作成
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into user_profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- admin_list_users() — 管理者用: 全ユーザーのemail + 権限一覧
-- auth.usersのemailを返すため security definer + 管理者チェック必須
-- ============================================================
create or replace function admin_list_users()
returns table (
  user_id uuid,
  email text,
  role text,
  can_upload boolean,
  can_process boolean,
  can_chat boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'forbidden';
  end if;
  return query
    select p.user_id, u.email::text, p.role, p.can_upload, p.can_process, p.can_chat, u.created_at
    from user_profiles p
    join auth.users u on u.id = p.user_id
    order by u.created_at;
end;
$$;

revoke execute on function admin_list_users() from anon;
