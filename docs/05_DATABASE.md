# 05_DATABASE — DB設計（Supabase PostgreSQL）

拡張: `vector`（pgvector）, `pg_trgm`。全テーブルRLS有効、`user_id = auth.uid()` ポリシー。ユーザー情報は `auth.users` を使用（独自Usersテーブルは作らない）。

## ER概要
```
documents 1─* pages 1─* chunks *─* concepts（chunk_concepts経由）
documents 1─* jobs        concepts 1─* concept_links（自己参照）
                          concepts 1─* concept_mentions
```

## DDL

```sql
create table documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  title text not null,
  author text,
  doc_type text not null default 'book' check (doc_type in ('book','pdf','note')),
  status text not null default 'created' check (status in ('created','uploading','processing','completed','failed')),
  page_count int,
  r2_prefix text not null,            -- '{user_id}/{document_id}/'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  document_id uuid not null references documents(id) on delete cascade,
  page_number int not null,
  status text not null default 'pending' check (status in ('pending','processing','completed','failed')),
  page_type text,                     -- content | toc | cover | index | blank
  r2_image_key text not null,
  r2_markdown_key text,
  r2_analysis_key text,               -- PageAnalysis JSON
  error text,
  unique (document_id, page_number)
);

create table chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  document_id uuid not null references documents(id) on delete cascade,
  chunk_type text not null default 'text' check (chunk_type in ('text','figure','table','formula')),
  content text not null,
  section_path text,                  -- '第3章 > 3.2 リスク対応'
  page_start int not null,
  page_end int not null,
  embedding vector(1024),             -- BGE-M3
  fts tsvector generated always as (to_tsvector('simple', content)) stored,
  created_at timestamptz not null default now()
);
create index on chunks using hnsw (embedding vector_cosine_ops);
create index on chunks using gin (fts);
create index on chunks using gin (content gin_trgm_ops);

create table concepts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  canonical_name text not null,
  aliases text[] not null default '{}',
  parent_concept_id uuid references concepts(id),
  importance real not null default 0.5,
  embedding vector(1024),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, canonical_name)
);

create table concept_mentions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  concept_id uuid not null references concepts(id) on delete cascade,
  chunk_id uuid not null references chunks(id) on delete cascade,
  document_id uuid not null references documents(id) on delete cascade,
  definition text,                    -- この文脈での定義・説明
  unique (concept_id, chunk_id)
);

create table concept_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  source_concept_id uuid not null references concepts(id) on delete cascade,
  target_concept_id uuid not null references concepts(id) on delete cascade,
  relation text not null check (relation in ('is_a','part_of','relates_to','contradicts','same_as')),
  evidence_chunk_id uuid references chunks(id),
  created_at timestamptz not null default now(),
  unique (source_concept_id, target_concept_id, relation)
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  document_id uuid not null references documents(id) on delete cascade,
  job_type text not null default 'process_document',
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  progress int not null default 0,    -- 0-100
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
-- 同一ドキュメントで同時に1ジョブ
create unique index jobs_active_uniq on jobs (document_id) where status in ('queued','processing');
```

## RLSポリシー（全テーブル共通パターン）
```sql
alter table documents enable row level security;
create policy "own rows" on documents for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- pages, chunks, concepts, concept_mentions, concept_links, jobs にも同様に適用
```
バッチ（service role）はRLSをバイパスするが、必ずjob行のuser_idを引き回して書き込む。

## Hybrid検索クエリ（M3、RPC関数として実装）
`search_chunks(query_embedding vector, query_text text, uid uuid)`:
vector top20 と FTS/trgm top20 をRRF（k=60）で統合し、citation情報をjoinして返す。
