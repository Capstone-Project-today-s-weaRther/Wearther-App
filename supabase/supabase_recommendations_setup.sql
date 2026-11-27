-- ============================================================================
-- 옷늘날씨: 기존 Supabase 테이블 구조 100% 반영 통합 설정 SQL
-- ============================================================================
-- 확인된 기존 테이블 활용:
--   - public.fashion_images       (1,141행: 권역/기온대별 코디 이미지)
--   - public.weather_clothing_map (8개 기온대 기준표)
--   - public.region_map           (18,626행: 전국 시도/시군구/동 + zone + 기상청 nx, ny)
--   - public.region_adjust        (권역별 기온 보정치 temp_offset)
--   - public.region_preset        (32개 주요 핫플/동네 별칭)
--   - public.user_feedback        (기존 피드백 테이블: item_name, feedback_score)
--
-- 추가/구성되는 객체:
--   1. public.outfit_feedback                  (시연용 추웠음/딱좋음/더웠음 피드백)
--   2. public.search_regions(text, int)        (위치 검색창 자동완성 + 기상청 nx, ny 반환)
--   3. public.resolve_zone(text)               (지역명 -> 19개 권역 자동 변환)
--   4. public.get_session_temp_offset(text)    (피드백 누적 체감 기온 보정)
--   5. public.match_temp_range(numeric)        (기온 -> 기온대 라벨)
--   6. public.recommend_outfits(...)           (권역 + 기온대 + 피드백 가중치 Top 4)
--   7. public.submit_outfit_feedback(...)      (피드백 저장 -> outfit_feedback & user_feedback)
--   8. public.get_recommendations_by_weather(...) (최종 JSON 반환 RPC)
-- ============================================================================


-- ---------- 1. 착용 피드백 저장 테이블 (로그인 없는 시연용 'demo' 기본) ----------
create table if not exists public.outfit_feedback (
  id           bigserial primary key,
  session_id   text not null default 'demo',
  region       text,
  zone         text,
  temp         numeric(4,1),
  temp_range   text,
  outfit_image text,
  outfit_title text,
  feedback     text not null check (feedback in ('cold', 'good', 'hot')),
  comment      text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_outfit_feedback_session
  on public.outfit_feedback (session_id, created_at desc);


-- ---------- 2. 위치 검색창 자동완성 RPC (region_map 18,626행 + 기상청 nx, ny) ----------
-- 예: search_regions('서교동') -> [{ sido, sigungu, dong, label, zone, nx, ny }]
create or replace function public.search_regions(
  p_query text,
  p_limit int default 15
)
returns table (
  label   text,
  sido    text,
  sigungu text,
  dong    text,
  zone    text,
  nx      int,
  ny      int
)
language sql
stable
as $fn$
  with q as (
    select regexp_replace(coalesce(trim(p_query), ''), '\s+', ' ', 'g') as txt
  )
  select
    trim(concat_ws(' ', r.sido, nullif(r.sigungu, ''), nullif(r.dong, ''))) as label,
    r.sido,
    r.sigungu,
    r.dong,
    r.zone,
    r.nx,
    r.ny
  from public.region_map r, q
  where q.txt <> ''
    and (
      trim(concat_ws(' ', r.sido, r.sigungu, r.dong)) ilike '%' || q.txt || '%'
      or r.dong ilike q.txt || '%'
      or r.sigungu ilike q.txt || '%'
    )
  order by
    case when r.dong = q.txt then 0
         when r.sigungu = q.txt then 1
         when r.dong ilike q.txt || '%' then 2
         else 3 end,
    length(coalesce(r.dong, '')),
    r.id
  limit greatest(p_limit, 1)
$fn$;


-- ---------- 3. 지역명 -> 19개 권역(zone) 자동 매핑 ----------
-- 우선순위: 19개 권역명 -> region_preset -> region_map(18,626행) -> 광역시/도 폴백
create or replace function public.resolve_zone(p_region text)
returns text
language plpgsql
stable
as $fn$
declare
  v_q    text := regexp_replace(coalesce(trim(p_region), ''), '\s+', ' ', 'g');
  v_zone text;
begin
  if v_q = '' then
    return null;
  end if;

  -- (1) 이미 19개 권역명 그대로 들어온 경우
  if v_q in (
    '서울_동','서울_서','서울_남','서울_북',
    '부산','대구','인천','대전','울산','세종','제주',
    '강원','전북','전남','경기','충북','충남','경북','경남'
  ) then
    return v_q;
  end if;

  -- (2) region_preset 핫플/별칭 매칭 ('성수', '홍대', '판교' 등)
  select p.zone into v_zone
  from public.region_preset p
  where v_q = p.key
     or v_q ilike '%' || p.key || '%'
     or (p.sigungu is not null and v_q ilike '%' || p.sigungu || '%')
     or (p.dong is not null and v_q ilike '%' || p.dong || '%')
  order by p.sort_order
  limit 1;

  if v_zone is not null then
    return v_zone;
  end if;

  -- (3) public.region_map (18,626개 전국 행정구역) 직접 조회
  select r.zone into v_zone
  from public.region_map r
  where trim(concat_ws(' ', r.sido, nullif(r.sigungu, ''), nullif(r.dong, ''))) = v_q
     or (nullif(r.dong, '') is not null and v_q ilike '%' || r.dong || '%' and (nullif(r.sigungu, '') is null or v_q ilike '%' || r.sigungu || '%'))
     or (nullif(r.sigungu, '') is not null and v_q ilike '%' || r.sigungu || '%')
     or (nullif(r.dong, '') is not null and v_q ilike '%' || r.dong || '%')
  order by
    case when trim(concat_ws(' ', r.sido, nullif(r.sigungu, ''), nullif(r.dong, ''))) = v_q then 0
         when nullif(r.dong, '') is not null and v_q ilike '%' || r.dong || '%' then 1
         else 2 end,
    r.id
  limit 1;

  if v_zone is not null then
    return v_zone;
  end if;

  -- (4) 광역시·도 키워드 폴백
  if v_q ~ '(서울)' then return '서울_북'; end if;
  if v_q ~ '(부산)' then return '부산'; end if;
  if v_q ~ '(대구)' then return '대구'; end if;
  if v_q ~ '(인천)' then return '인천'; end if;
  if v_q ~ '(대전)' then return '대전'; end if;
  if v_q ~ '(울산)' then return '울산'; end if;
  if v_q ~ '(세종)' then return '세종'; end if;
  if v_q ~ '(제주|서귀포)' then return '제주'; end if;
  if v_q ~ '(강원)' then return '강원'; end if;
  if v_q ~ '(전북|전라북)' then return '전북'; end if;
  if v_q ~ '(전남|전라남|광주)' then return '전남'; end if;
  if v_q ~ '(경기)' then return '경기'; end if;
  if v_q ~ '(충북|충청북)' then return '충북'; end if;
  if v_q ~ '(충남|충청남)' then return '충남'; end if;
  if v_q ~ '(경북|경상북)' then return '경북'; end if;
  if v_q ~ '(경남|경상남)' then return '경남'; end if;

  return null;
end;
$fn$;


-- ---------- 4. 누적 피드백 기반 체감 기온 보정값 ----------
create or replace function public.get_session_temp_offset(
  p_session_id text default 'demo'
)
returns numeric
language sql
stable
as $fn$
  select greatest(-4.0, least(4.0, coalesce(sum(delta), 0.0)))
  from (
    select case feedback
             when 'cold' then -2.0
             when 'hot'  then  2.0
             else 0.0
           end as delta
    from public.outfit_feedback
    where session_id = coalesce(nullif(trim(p_session_id), ''), 'demo')
    order by created_at desc
    limit 5
  ) recent
$fn$;


-- ---------- 5. 기온 -> 기온대(weather_clothing_map) 매칭 ----------
create or replace function public.match_temp_range(p_temp numeric)
returns text
language sql
stable
as $fn$
  select m.temp_range_label
  from public.weather_clothing_map m
  where p_temp between m.temp_min and m.temp_max
  order by (m.temp_max - m.temp_min) asc, m.temp_min asc
  limit 1
$fn$;

create or replace function public.match_temp_range_fallback(p_temp numeric)
returns text
language sql
stable
as $fn$
  select m.temp_range_label
  from public.weather_clothing_map m
  order by abs(((m.temp_min + m.temp_max)::numeric / 2) - p_temp) asc
  limit 1
$fn$;


-- ---------- 6. 권역 + 기온대 + 피드백 가중치 기반 Top 4 추출 ----------
create or replace function public.recommend_outfits(
  p_zone       text,
  p_label      text,
  p_limit      int  default 4,
  p_session_id text default 'demo'
)
returns jsonb
language sql
stable
as $fn$
  with fb_weight as (
    select outfit_image,
           sum(case feedback
                 when 'good' then  0.08
                 when 'cold' then -0.05
                 when 'hot'  then -0.05
                 else 0.0
               end) as bonus
    from public.outfit_feedback
    where session_id = coalesce(nullif(trim(p_session_id), ''), 'demo')
      and outfit_image is not null
    group by outfit_image
  ),
  src as (
    -- 1순위(zone): 같은 권역 + 같은 기온대
    select 1 as tier,
           f.clothing_items::text as sig,
           f.clothing_items as items,
           f.image_url,
           coalesce(f.keyword, '오늘코디') as title,
           f.id as ord,
           0.00::numeric as penalty,
           coalesce(fw.bonus, 0.00::numeric) as fb_bonus
    from public.fashion_images f
    left join fb_weight fw on fw.outfit_image = f.image_url
    where f.zone = p_zone
      and f.temp_range = p_label
      and f.image_url is not null

    union all

    -- 2순위(band): 다른 권역 + 같은 기온대
    select 2,
           g.clothing_items::text,
           g.clothing_items,
           g.image_url,
           coalesce(g.keyword, '오늘코디'),
           g.id,
           0.05,
           coalesce(fw.bonus, 0.00::numeric)
    from public.fashion_images g
    left join fb_weight fw on fw.outfit_image = g.image_url
    where g.zone is distinct from p_zone
      and g.temp_range = p_label
      and g.image_url is not null

    union all

    -- 3순위(guide): weather_clothing_map 기준표
    select 3,
           m.clothing_items::text || '|' || kw,
           m.clothing_items,
           (select i.image_url
              from public.fashion_images i
             where i.temp_range = p_label
               and i.image_url is not null
             order by i.zone, i.id
             limit 1),
           kw || ' 룩',
           m.id,
           0.15,
           0.00::numeric
    from public.weather_clothing_map m
    cross join lateral unnest(m.style_keyword) as kw
    where m.temp_range_label = p_label
  ),
  dedup as (
    select distinct on (sig) *
    from src
    order by sig, tier asc, fb_bonus desc, ord asc
  ),
  ranked as (
    select *,
           row_number() over (order by tier asc, fb_bonus desc, ord asc) as rn
    from dedup
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'rank',   rn,
        'source', case tier when 1 then 'zone' when 2 then 'band' else 'guide' end,
        'title',  title,
        'items',  to_jsonb(items),
        'image',  image_url,
        'score',  round(greatest(0.10, least(1.00, (1.05 - rn * 0.05 - penalty + fb_bonus)))::numeric, 2)
      )
      order by rn
    ),
    '[]'::jsonb
  )
  from ranked
  where rn <= greatest(p_limit, 0)
$fn$;


-- ---------- 7. 사용자 피드백 저장 RPC (outfit_feedback + 기존 user_feedback 동시 기록) ----------
create or replace function public.submit_outfit_feedback(
  p_feedback     text,
  p_region       text    default null,
  p_temp         numeric default null,
  p_outfit_image text    default null,
  p_outfit_title text    default null,
  p_comment      text    default null,
  p_session_id   text    default 'demo'
)
returns jsonb
language plpgsql
as $fn$
declare
  v_sid    text := coalesce(nullif(trim(p_session_id), ''), 'demo');
  v_zone   text := public.resolve_zone(p_region);
  v_range  text;
  v_id     bigint;
  v_offset numeric;
begin
  if p_feedback not in ('cold', 'good', 'hot') then
    raise exception 'feedback must be one of cold, good, hot';
  end if;

  if p_temp is not null then
    v_range := coalesce(
      public.match_temp_range(p_temp),
      public.match_temp_range_fallback(p_temp)
    );
  end if;

  insert into public.outfit_feedback (
    session_id, region, zone, temp, temp_range,
    outfit_image, outfit_title, feedback, comment
  ) values (
    v_sid, p_region, v_zone, p_temp, v_range,
    p_outfit_image, p_outfit_title, p_feedback, p_comment
  )
  returning id into v_id;

  -- 기존 user_feedback 테이블에도 호환 기록
  insert into public.user_feedback (temp_range_label, item_name, feedback_score)
  values (
    coalesce(v_range, '기타'),
    coalesce(nullif(trim(p_outfit_title), ''), '오늘코디'),
    case p_feedback when 'good' then 1 else -1 end
  );

  v_offset := public.get_session_temp_offset(v_sid);

  return jsonb_build_object(
    'id',          v_id,
    'session_id',  v_sid,
    'zone',        v_zone,
    'feedback',    p_feedback,
    'temp_offset', v_offset
  );
end;
$fn$;


-- ---------- 8. 최종 RPC: 입력 지역 + 기상청 API 값 -> recommendations.json 반환 ----------
-- 지역 보정(region_adjust.temp_offset) + 피드백 보정(get_session_temp_offset) 동시 반영
create or replace function public.get_recommendations_by_weather(
  p_region     text,
  p_weather    jsonb,
  p_session_id text default 'demo'
)
returns jsonb
language plpgsql
stable
as $fn$
declare
  v_sid         text := coalesce(nullif(trim(p_session_id), ''), 'demo');
  v_zone        text := public.resolve_zone(p_region);
  v_region_adj  numeric := 0.0;
  v_fb_offset   numeric := public.get_session_temp_offset(v_sid);
  v_total_off   numeric;
  v_slots       text[] := array['아침', '낮', '저녁'];
  v_slot        text;
  v_w           jsonb;
  v_temp        numeric;
  v_eff_temp    numeric;
  v_label       text;
  v_band        record;
  v_top4        jsonb;
  v_img         text;
  v_comment     text;
  v_region      jsonb := '{}'::jsonb;
  v_empty       jsonb := jsonb_build_object(
                           'weather', '{}'::jsonb,
                           'top4', '[]'::jsonb,
                           'recommendation', jsonb_build_object(
                             'comment', '', 'image', null, 'products', '[]'::jsonb));
begin
  if v_zone is null then
    return jsonb_build_object(
      'updated_at', to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || '+09:00',
      'zone', null,
      'temp_offset', v_fb_offset,
      'regions', jsonb_build_object(
        p_region, jsonb_build_object('아침', v_empty, '낮', v_empty, '저녁', v_empty)
      )
    );
  end if;

  select coalesce(ra.temp_offset, 0.0) into v_region_adj
  from public.region_adjust ra
  where ra.zone = v_zone
  limit 1;

  v_total_off := coalesce(v_region_adj, 0.0) + coalesce(v_fb_offset, 0.0);

  foreach v_slot in array v_slots
  loop
    v_w := p_weather -> v_slot;

    if v_w is null or (v_w ->> 'temp') is null then
      v_region := v_region || jsonb_build_object(v_slot, v_empty);
      continue;
    end if;

    v_temp     := (v_w ->> 'temp')::numeric;
    v_eff_temp := v_temp + v_total_off;
    v_label    := coalesce(
                    public.match_temp_range(v_eff_temp),
                    public.match_temp_range_fallback(v_eff_temp)
                  );

    select * into v_band
    from public.weather_clothing_map m
    where m.temp_range_label = v_label
    limit 1;

    v_top4 := public.recommend_outfits(v_zone, v_label, 4, v_sid);
    v_img  := v_top4 -> 0 ->> 'image';
    v_comment := coalesce(
      (select f.description
         from public.fashion_images f
        where f.image_url = v_img
          and f.description is not null
        limit 1),
      v_band.description,
      ''
    );

    v_region := v_region || jsonb_build_object(v_slot, jsonb_build_object(
      'weather', v_w || jsonb_build_object(
        'effective_temp',  v_eff_temp,
        'temp_offset',     v_total_off,
        'range_label',     v_label,
        'weather_keyword', v_band.weather_keyword
      ),
      'top4', v_top4,
      'recommendation', jsonb_build_object(
        'comment',  coalesce(v_comment, ''),
        'image',    v_img,
        'products', '[]'::jsonb
      )
    ));
  end loop;

  return jsonb_build_object(
    'updated_at', to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || '+09:00',
    'zone', v_zone,
    'temp_offset', v_total_off,
    'regions', jsonb_build_object(p_region, v_region)
  );
end;
$fn$;


-- ---------- 9. 실행 검증 쿼리 ----------
select jsonb_pretty(
  public.get_recommendations_by_weather(
    '서울특별시 마포구 서교동',
    '{
      "아침": {"temp": 1.0, "feels_like": -0.5, "temp_min": 1, "temp_max": 6, "sky": "맑음", "pop": 10},
      "낮":   {"temp": 6.0, "feels_like": 5.5,  "temp_min": 1, "temp_max": 6, "sky": "맑음", "pop": 10},
      "저녁": {"temp": 2.5, "feels_like": 1.0,  "temp_min": 1, "temp_max": 6, "sky": "맑음", "pop": 10}
    }'::jsonb
  )
) as test_result;