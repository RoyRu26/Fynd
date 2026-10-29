-- Hardening for listing_ai_analyses (follow-up to
-- 20261026172933_listing_ai_analyses.sql, already applied locally), from the
-- Phase 2 security review:
--
-- 1. record_listing_ai_analysis refuses duplicate image paths (an analysis
--    looks at distinct photos), and caps records per USER at 100 per rolling
--    24h in addition to the 30-per-listing cap, so creating many drafts can't
--    multiply table growth. Otherwise identical; `create or replace` keeps the
--    EXECUTE grants (authenticated only).
-- 2. The table is documented as self-reported: rows are written through an
--    RPC the user can also call directly (the Edge Function runs as the
--    user), so usage/latency/status figures are only trustworthy for
--    evaluation where they line up with a server-recorded attempt in
--    ai_suggestion_calls. The Edge Function re-validates any cached
--    suggestion against the current vocabulary before serving it.

create or replace function public.record_listing_ai_analysis(
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

  -- No path twice: an analysis looks at distinct photos.
  if cardinality(p_image_paths) <> (select count(distinct p.path) from unnest(p_image_paths) as p(path)) then
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

  -- And per user, so many drafts can't multiply that: 100 records per user
  -- per rolling 24h (the 20-attempt user quota produces at most 20 real ones).
  if (
    select count(*) from public.listing_ai_analyses a
     where a.user_id = v_user_id
       and a.created_at > now() - interval '24 hours'
  ) >= 100 then
    raise exception 'Too many analysis records' using errcode = 'P0001';
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

comment on table public.listing_ai_analyses is
  'AI listing analyses (Phase 2). Written only via record_listing_ai_analysis, which the user can also call '
  'directly: rows are self-reported for the caller''s own draft and visible only to them. For evaluation, '
  'trust status/usage figures only where a matching ai_suggestion_calls attempt exists. The suggest-listing '
  'Edge Function re-validates cached suggestions against the current vocabulary before serving them.';
