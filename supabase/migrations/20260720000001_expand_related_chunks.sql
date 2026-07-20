-- Graph expansion RPC（KPS §8 手順4）:
-- ヒットしたチャンクに紐づく概念の1-hop先の概念から、関連チャンクを最大match_count件返す。
-- 元のヒットチャンク自身と、元概念に直接紐づくチャンクの重複は呼び出し側でも除外するが、
-- ここでも source_chunk_ids は除外する。並びは概念importance・言及数の降順。
create or replace function expand_related_chunks(
  source_chunk_ids uuid[],
  uid uuid,
  match_count int default 5
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
  with source_concepts as (
    select distinct cm.concept_id
    from concept_mentions cm
    where cm.user_id = uid and cm.chunk_id = any(source_chunk_ids)
  ),
  neighbor_concepts as (
    select distinct
      case
        when cl.source_concept_id in (select concept_id from source_concepts)
          then cl.target_concept_id
        else cl.source_concept_id
      end as concept_id
    from concept_links cl
    where cl.user_id = uid
      and (
        cl.source_concept_id in (select concept_id from source_concepts)
        or cl.target_concept_id in (select concept_id from source_concepts)
      )
  ),
  candidate_chunks as (
    select
      cm.chunk_id,
      max(co.importance) as max_importance,
      count(*) as mention_count
    from concept_mentions cm
    join concepts co on co.id = cm.concept_id
    where cm.user_id = uid
      and cm.concept_id in (
        select concept_id from neighbor_concepts
        where concept_id not in (select concept_id from source_concepts)
      )
      and not (cm.chunk_id = any(source_chunk_ids))
    group by cm.chunk_id
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
    q.max_importance::float as score
  from candidate_chunks q
  join chunks c on c.id = q.chunk_id
  join documents d on d.id = c.document_id
  order by q.max_importance desc, q.mention_count desc
  limit match_count;
$$;
