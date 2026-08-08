#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
project_ref_file="$repo_root/supabase/.temp/project-ref"

if [[ ! -s "$project_ref_file" ]]; then
  echo "Link the Supabase project before running linked database fixtures." >&2
  exit 1
fi

project_ref="$(tr -d '\n' < "$project_ref_file")"
api_keys="$(supabase projects api-keys --project-ref "$project_ref" -o json)"
publishable_key="$(jq -er 'first(.[] | select(.type == "publishable") | .api_key)' <<< "$api_keys")"
# Linked fixtures call Auth admin endpoints and raw PostgREST Bearer routes, which require a JWT key.
secret_key="$(jq -er 'first(.[] | select(.name == "service_role" and .type == "legacy") | .api_key)' <<< "$api_keys")"

cd "$repo_root"
DREAMTRACE_DB_INTEGRATION=1 \
NEXT_PUBLIC_SUPABASE_URL="https://${project_ref}.supabase.co" \
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="$publishable_key" \
SUPABASE_SECRET_KEY="$secret_key" \
pnpm --dir web "$@"
