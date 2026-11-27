-- WEARther demo: location search enhancement + minimum Supabase anon policies
-- Run after supabase_recommendations_setup.sql in Supabase SQL Editor.

-- 1) Region search: supports city-level aggregates and numbered dong aliases.
--    Example: "나운동" matches stored "나운1동" / "나운2동" IF those rows exist.
--    This query does not invent administrative districts absent from region_map.
create or replace function public.search_regions(
  p_query text,
  p_limit int default 30
)
returns table (
  label text,
  sido text,
  sigungu text,
  dong text,
  zone text,
  nx int,
  ny int
)
language sql
stable
as $fn$
  with q as (
    select
      regexp_replace(coalesce(trim(p_query), ''), '\s+', ' ', 'g') as txt,
      regexp_replace(coalesce(trim(p_query), ''), '\s+', '', 'g') as compact
  )
  select
    trim(concat_ws(' ', r.sido, nullif(r.sigungu, ''), nullif(r.dong, ''))) as label,
    r.sido, r.sigungu, r.dong, r.zone, r.nx, r.ny
  from public.region_map r, q
  where q.txt <> ''
    and (
      replace(trim(concat_ws(' ', r.sido, nullif(r.sigungu, ''), nullif(r.dong, ''))), ' ', '') ilike '%' || q.compact || '%'
      or replace(coalesce(r.dong, ''), ' ', '') ilike '%' || q.compact || '%'
      or replace(coalesce(r.sigungu, ''), ' ', '') ilike '%' || q.compact || '%'
      or regexp_replace(coalesce(r.dong, ''), '[0-9]+동$', '동') = q.txt
      or regexp_replace(coalesce(r.dong, ''), '[0-9]+동$', '동') ilike q.txt || '%'
      or not exists (
        select 1 from regexp_split_to_table(q.txt, '\s+') as token(value)
        where token.value <> ''
          and r.sido not ilike '%' || token.value || '%'
          and coalesce(r.sigungu, '') not ilike '%' || token.value || '%'
          and coalesce(r.dong, '') not ilike '%' || token.value || '%'
      )
    )
  order by
    case
      when trim(concat_ws(' ', r.sido, nullif(r.sigungu, ''), nullif(r.dong, ''))) = q.txt then 0
      when r.sigungu = q.txt and coalesce(r.dong, '') = '' then 1
      when r.dong = q.txt then 2
      when regexp_replace(coalesce(r.dong, ''), '[0-9]+동$', '동') = q.txt then 3
      when r.dong ilike q.txt || '%' then 4
      else 5
    end,
    length(coalesce(r.dong, '')),
    r.id
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$fn$;

-- 2) Anonymous demo access. Public weather/catalog data is readable.
--    Review rows are restricted to the browser's random x-wearther-session header.
--    This is a demo-session boundary, not equivalent to authenticated user identity.

do $$
begin
  if to_regclass('public.region_map') is not null then
    alter table public.region_map enable row level security;
    drop policy if exists wearther_region_map_read on public.region_map;
    create policy wearther_region_map_read on public.region_map for select to anon, authenticated using (true);
  end if;
  if to_regclass('public.region_preset') is not null then
    alter table public.region_preset enable row level security;
    drop policy if exists wearther_region_preset_read on public.region_preset;
    create policy wearther_region_preset_read on public.region_preset for select to anon, authenticated using (true);
  end if;
  if to_regclass('public.fashion_images') is not null then
    alter table public.fashion_images enable row level security;
    drop policy if exists wearther_fashion_images_read on public.fashion_images;
    create policy wearther_fashion_images_read on public.fashion_images for select to anon, authenticated using (true);
  end if;
  if to_regclass('public.weather_clothing_map') is not null then
    alter table public.weather_clothing_map enable row level security;
    drop policy if exists wearther_weather_map_read on public.weather_clothing_map;
    create policy wearther_weather_map_read on public.weather_clothing_map for select to anon, authenticated using (true);
  end if;
  if to_regclass('public.region_adjust') is not null then
    alter table public.region_adjust enable row level security;
    drop policy if exists wearther_region_adjust_read on public.region_adjust;
    create policy wearther_region_adjust_read on public.region_adjust for select to anon, authenticated using (true);
  end if;
  if to_regclass('public.outfit_feedback') is not null then
    alter table public.outfit_feedback enable row level security;
    drop policy if exists wearther_feedback_demo_read on public.outfit_feedback;
    drop policy if exists wearther_feedback_demo_insert on public.outfit_feedback;
    create policy wearther_feedback_demo_read on public.outfit_feedback for select to anon, authenticated
      using (session_id = nullif(current_setting('request.headers', true)::jsonb ->> 'x-wearther-session', ''));
    create policy wearther_feedback_demo_insert on public.outfit_feedback for insert to anon, authenticated
      with check (session_id = nullif(current_setting('request.headers', true)::jsonb ->> 'x-wearther-session', ''));
  end if;
  if to_regclass('public.user_feedback') is not null then
    alter table public.user_feedback enable row level security;
    drop policy if exists wearther_user_feedback_demo_insert on public.user_feedback;
    create policy wearther_user_feedback_demo_insert on public.user_feedback for insert to anon, authenticated with check (true);
  end if;
end $$;

grant execute on function public.search_regions(text, int) to anon, authenticated;
grant execute on function public.get_session_temp_offset(text) to anon, authenticated;
grant execute on function public.submit_outfit_feedback(text, text, numeric, text, text, text, text) to anon, authenticated;
