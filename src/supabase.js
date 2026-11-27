import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(url && anonKey && !url.includes('YOUR_PROJECT'));

// 비로그인 데모에서는 브라우저가 만든 랜덤 세션 ID를 요청 헤더에 동봉합니다.
// RLS에서 outfit_feedback을 현재 브라우저 세션 기준으로 필터링하는 용도입니다.
const sessionAwareFetch = (input, init = {}) => {
  const headers = new Headers(init.headers || {});
  try {
    const sessionId = localStorage.getItem('wearther_session_id');
    if (sessionId) headers.set('x-wearther-session', sessionId);
  } catch { /* SSR 또는 localStorage 차단 환경에서는 헤더 없이 요청합니다. */ }
  return fetch(input, { ...init, headers });
};

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: sessionAwareFetch },
    })
  : null;
