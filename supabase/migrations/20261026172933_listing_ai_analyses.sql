-- AI listing metadata, Phase 2: persisted analyses and the per-listing limit.
--
-- listing_ai_analyses records every analysis the suggest-listing Edge
-- Function runs (or fails to run) for a draft:
--
--   * the cache identity: analysis_input_hash = sha256 over the exact model
--     id, prompt version, metadata_schema_version (a hash of every
--     controlled vocabulary offered to the model), the ordered analyzed image
--     paths, and the trimmed title/description/category hint. A succeeded
--     analysis with the same hash is returned without a model call and
--     without charging quota (the Edge Function looks it up BEFORE calling
--     record_ai_suggestion_attempt);
--   * the validated, normalized suggestion (term ids, resolved brand) —
--     never raw model output;
--   * enough status/usage data to debug and evaluate (status, failure
--     reason code, validation issue codes, tokens, latency), and no secrets.
--
-- Access model, same caller-JWT architecture as ai_suggestion_calls (no
-- service role anywhere):
--   * SELECT: the owner only (restoring suggestions when a draft reopens).
--   * No client INSERT/UPDATE/DELETE grant. The only writer is
--     record_listing_ai_analysis below, SECURITY DEFINER, which re-checks
--     that the caller owns the listing, that it is still a draft, and that
--     every image path really is one of THAT listing's images.
--   * Accepted, documented: the Edge Function runs as the user, so the user
--     can also call record_listing_ai_analysis directly and record a fake
--     "succeeded" analysis. It can only ever concern their own draft and is
--     only ever shown to themselves, every suggested value is re-validated by
--     set_listing_attributes / the listings constraints when they save, and
--     the per-listing row cap bounds table growth. Closing that would need a
--     service-role writer, which this architecture deliberately avoids.
--
-- record_ai_suggestion_attempt gains the approved per-listing protection:
-- at most 3 attempts (cache misses) per listing per rolling 24h, on top of
-- the existing 20 per user. It now also says which limit was hit.

-- ============================================================
-- listing_ai_analyses
-- ============================================================
create table public.listing_ai_analyses (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null,
  failure_reason text,
  validation_issues text[] not null default '{}',
  model text not null,
  prompt_version integer not null,
  metadata_schema_version text not null,
  analysis_input_hash text not null,
  image_paths text[] not null,
  suggestion jsonb,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,

  constraint listing_ai_analyses_status check (status in ('succeeded', 'failed', 'invalid')),
  -- A succeeded analysis carries a suggestion and no failure reason; a failed
  -- or invalid one carries a reason and no suggestion.
  constraint listing_ai_analyses_outcome check (
    (status = 'succeeded' and suggestion is not null and failure_reason is null)
    or (status <> 'succeeded' and suggestion is null and failure_reason is not null)
  ),
  constraint listing_ai_analyses_failure_reason check (
    failure_reason is null or failure_reason ~ '^[a-z][a-z0-9_]{0,39}$'
  ),
  constraint listing_ai_analyses_validation_issues check (
    cardinality(validation_issues) <= 50
  ),
  constraint listing_ai_analyses_model check (model ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  constraint listing_ai_analyses_prompt_version check (prompt_version between 1 and 1000),
  constraint listing_ai_analyses_metadata_schema_version check (metadata_schema_version ~ '^[0-9a-f]{64}$'),
  constraint listing_ai_analyses_input_hash check (analysis_input_hash ~ '^[0-9a-f]{64}$'),
  constraint listing_ai_analyses_image_paths check (cardinality(image_paths) between 1 and 4),
  constraint listing_ai_analyses_suggestion check (
    suggestion is null
    or (jsonb_typeof(suggestion) = 'object' and octet_length(suggestion::text) <= 32768)
  ),
  constraint listing_ai_analyses_usage check (
    (input_tokens is null or input_tokens between 0 and 10000000)
    and (output_tokens is null or output_tokens between 0 and 10000000)
    and (latency_ms is null or latency_ms between 0 and 600000)
  )
);

-- Cache lookup (listing + hash, newest first) and "latest analysis for this
-- draft" (restore) both start from the listing.
create index listing_ai_analyses_listing_hash_idx
  on public.listing_ai_analyses (listing_id, analysis_input_hash, created_at desc);
create index listing_ai_analyses_listing_created_idx
  on public.listing_ai_analyses (listing_id, created_at desc);
create index listing_ai_analyses_user_id_idx on public.listing_ai_analyses (user_id);

alter table public.listing_ai_analyses enable row level security;

revoke all on public.listing_ai_analyses from public, anon, authenticated;
grant select on public.listing_ai_analyses to authenticated;

create policy "Users read own listing ai analyses"
  on public.listing_ai_analyses for select to authenticated
  using (user_id = (select auth.uid()));

-- ============================================================
-- record_listing_ai_analysis
-- ============================================================
-- The only writer. Called by the Edge Function (as the user) after an
-- analysis attempt. Returns the new row id.
create function public.record_listing_ai_analysis(
  p_listing_id uuid,
  p_status text,
  p_failure_reason text,
  p_validation_issues text[],
  p_model text,
  p_prompt_version integer,
  p_metadata_schema_version text,
  p_analysis_input_hash text,
  p_image_paths text[],
  p_suggestion jsonb,
  p_input_tokens integer,
  p_output_tokens integer,
  p_latency_ms integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  -- Same collapsed "not found" as record_ai_suggestion_attempt: doesn't
  -- exist, isn't yours and isn't a draft are indistinguishable.
  perform 1
    from public.listings l
   where l.id = p_listing_id
     and l.seller_id = v_user_id
     and l.status = 'draft'
   for update;
  if not found then
    raise exception 'Listing not found' using errcode = '42501';
  end if;

  -- Bounds checked before any per-element work.
  if cardinality(coalesce(p_image_paths, '{}')) not between 1 and 4
     or cardinality(coalesce(p_validation_issues, '{}')) > 50 then
    raise exception 'Invalid analysis record' using errcode = '22023';
  end if;

  -- Every analyzed path must be one of THIS listing's images: no arbitrary
  -- storage paths, no other listing's (or user's) photos.
  if exists (
    select 1
      from unnest(p_image_paths) as p(path)
     where p.path is null
        or not exists (
          select 1 from public.listing_images i
           where i.listing_id = p_listing_id
             and i.storage_path = p.path
        )
  ) then
    raise exception 'Invalid analysis record' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_validation_issues, '{}')) as v(issue)
     where v.issue is null or v.issue !~ '^[a-z][a-z0-9_.]{0,59}$'
  ) then
    raise exception 'Invalid analysis record' using errcode = '22023';
  end if;

  -- Bounded table growth even if called directly: 30 records per listing per
  -- rolling 24h is far above what the 3-attempt limit can produce.
  if (
    select count(*) from public.listing_ai_analyses a
     where a.listing_id = p_listing_id
       and a.created_at > now() - interval '24 hours'
  ) >= 30 then
    raise exception 'Too many analysis records for this listing' using errcode = 'P0001';
  end if;

  -- The table's CHECK constraints validate everything else (status/outcome
  -- consistency, formats, sizes) and raise 23514.
  insert into public.listing_ai_analyses (
    listing_id, user_id, status, failure_reason, validation_issues, model,
    prompt_version, metadata_schema_version, analysis_input_hash, image_paths,
    suggestion, input_tokens, output_tokens, latency_ms
  ) values (
    p_listing_id, v_user_id, p_status, p_failure_reason, coalesce(p_validation_issues, '{}'), p_model,
    p_prompt_version, p_metadata_schema_version, p_analysis_input_hash, p_image_paths,
    p_suggestion, p_input_tokens, p_output_tokens, p_latency_ms
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_listing_ai_analysis(
  uuid, text, text, text[], text, integer, text, text, text[], jsonb, integer, integer, integer
) from public, anon;
grant execute on function public.record_listing_ai_analysis(
  uuid, text, text, text[], text, integer, text, text, text[], jsonb, integer, integer, integer
) to authenticated;

-- ============================================================
-- record_ai_suggestion_attempt: + per-listing limit
-- ============================================================
-- Unchanged per-user behavior (20 / rolling 24h, advisory lock, ownership
-- and draft re-check). Added: at most 3 attempts per LISTING per rolling
-- 24h. Attempts are only recorded for cache misses (the Edge Function
-- returns a cached analysis before calling this), so cache hits never count
-- against either limit. `limited_by` says which limit denied the attempt
-- ('user' or 'listing'), or is null when allowed. The return type changes, so
-- the function is dropped and re-created (a function, not data); its only
-- caller is the Edge Function.
drop function public.record_ai_suggestion_attempt(uuid);

create function public.record_ai_suggestion_attempt(p_listing_id uuid)
returns table (allowed boolean, remaining integer, limited_by text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_count integer;
  v_listing_count integer;
  v_limit constant integer := 20;
  v_listing_limit constant integer := 3;
begin
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.listings l
     where l.id = p_listing_id
       and l.seller_id = v_user_id
       and l.status = 'draft'
  ) then
    raise exception 'Listing not found' using errcode = '42501';
  end if;

  -- One lock per user covers the per-listing count too: a listing has
  -- exactly one owner, so every attempt against it takes this same lock.
  perform pg_advisory_xact_lock(hashtextextended(v_user_id::text, 0));

  select count(*) into v_count
    from public.ai_suggestion_calls c
   where c.user_id = v_user_id
     and c.created_at > now() - interval '24 hours';

  if v_count >= v_limit then
    return query select false, 0, 'user'::text;
    return;
  end if;

  select count(*) into v_listing_count
    from public.ai_suggestion_calls c
   where c.listing_id = p_listing_id
     and c.created_at > now() - interval '24 hours';

  if v_listing_count >= v_listing_limit then
    return query select false, (v_limit - v_count), 'listing'::text;
    return;
  end if;

  insert into public.ai_suggestion_calls (user_id, listing_id)
  values (v_user_id, p_listing_id);

  return query select true, (v_limit - v_count - 1), null::text;
end;
$$;

revoke all on function public.record_ai_suggestion_attempt(uuid) from public, anon;
grant execute on function public.record_ai_suggestion_attempt(uuid) to authenticated;

-- Per-listing count lookup for the new limit.
create index ai_suggestion_calls_listing_id_created_at_idx
  on public.ai_suggestion_calls (listing_id, created_at desc);
