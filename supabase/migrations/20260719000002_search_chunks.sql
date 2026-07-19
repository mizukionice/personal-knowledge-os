-- Hybrid検索RPC（KPS §8 / 05_DATABASE）:
-- vector top20 と keyword（FTS + pg_trgm）top20 を RRF（k=60）で統合し、
-- citation情報（書名・ページ・セクション）をjoinして返す。
-- 日本語は分かち書きが無く 'simple' FTSが効きにくいため、trgm類似を併用する。
create or replace function search_chunks(
  query_embedding vector(1024),
  query_text text,
  uid uuid,
  match_count int default 10
) returns table (
  chunk_id uuid,
  content text,
  chunk_type text,
  document_id uuid,
  document_title text,
  page_start int,
  page_end int,
  section_path text,
  score float
)
language sql
stable
as $$
  with vector_hits as (
    select c.id, row_number() over (order by c.embedding <=> query_embedding) as rank
    from chunks c
    where c.user_id = uid and c.embedding is not null
    order by c.embedding <=> query_embedding
    limit 20
  ),
  keyword_hits as (
    select c.id,
           row_number() over (
             order by
               ts_rank(c.fts, websearch_to_tsquery('simple', query_text)) desc,
               similarity(c.content, query_text) desc
           ) as rank
    from chunks c
    where c.user_id = uid
      and (
        c.fts @@ websearch_to_tsquery('simple', query_text)
        or c.content % query_text
        or c.content ilike '%' || query_text || '%'
      )
    limit 20
  ),
  rrf as (
    select
      coalesce(v.id, k.id) as id,
      coalesce(1.0 / (60 + v.rank), 0) + coalesce(1.0 / (60 + k.rank), 0) as score
    from vector_hits v
    full outer join keyword_hits k on v.id = k.id
  )
  select
    c.id as chunk_id,
    c.content,
    c.chunk_type,
    c.document_id,
    d.title as document_title,
    c.page_start,
    c.page_end,
    c.section_path,
    r.score
  from rrf r
  join chunks c on c.id = r.id
  join documents d on d.id = c.document_id
  order by r.score desc
  limit match_count;
$$;
