#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  cp .env.example .env
  echo ".env 파일을 열어 Supabase와 KMA 키를 입력한 뒤 다시 실행하세요."
  exit 0
fi
if [ ! -d node_modules ]; then npm install; fi
npm run dev
