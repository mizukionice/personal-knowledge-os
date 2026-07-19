-- ConceptExtractorの既存概念照合（KPS §5 ②）: embedding類似度で候補を返す。
-- definitionは出典付き併記（KPS §10）のためconcept_mentionsに保存されるので、
-- 代表として最初のmentionの定義を返す。
create or replace function match_concepts(
  query_embedding vector(1024),
  uid uuid,
  similarity_threshold float default 0.90,
  match_count int default 5
) returns table (
  id uuid,
  canonical_name text,
  definition text,
  similarity float
)
language sql
stable
as $$
  select
    c.id,
    c.canonical_name,
    coalesce(
      (
        select cm.definition
        from concept_mentions cm
        where cm.concept_id = c.id and cm.definition is not null
        limit 1
      ),
      ''
    ) as definition,
    1 - (c.embedding <=> query_embedding) as similarity
  from concepts c
  where c.user_id = uid
    and c.embedding is not null
    and 1 - (c.embedding <=> query_embedding) > similarity_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;
