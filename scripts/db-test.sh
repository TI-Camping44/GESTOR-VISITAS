#!/usr/bin/env bash
# Prueba las migraciones y el RLS en un Postgres local (con PostGIS) que imita Supabase.
# Uso: PGHOST=/tmp PGPORT=54329 PGUSER=postgres npm run db:test
set -euo pipefail
cd "$(dirname "$0")/.."
P=(psql -v ON_ERROR_STOP=1 -q -X)
"${P[@]}" -d postgres -c "drop database if exists vis_test" -c "create database vis_test" >/dev/null
"${P[@]}" -d vis_test -f supabase/tests/00_stub_supabase.sql 2>&1 | grep -v -E 'wal_level|HINT' || true
for f in supabase/migrations/*.sql; do
  case "$f" in *_cron.sql|*_fotos.sql) echo "  (salteo $f: pg_cron y Storage solo existen en Supabase)"; continue;; esac
  "${P[@]}" -d vis_test -f "$f"
done
"${P[@]}" -d vis_test -f supabase/tests/01_rls_y_funciones.sql | grep -E 'OK:|ERROR' || { echo "Las pruebas fallaron"; exit 1; }
