#!/usr/bin/env bash
#
# Push the correct env vars from .env.local into Vercel's Production + Preview
# environments (with the exact names the code reads). Fixes the two problems on
# the SLIPPR project: vars were Development-only, and three were missing "_KEY".
#
# Prereq (one time, interactive — you must run it, it logs into Vercel):
#     npx vercel link          # pick the slippr/slippr project
#
# Then:
#     bash scripts/sync-env-to-vercel.sh
#     npx vercel --prod        # or just push a commit to redeploy
#
set -uo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env.local ]; then echo "No .env.local found."; exit 1; fi

VC="npx vercel"

# Vars to sync (correct, code-matching names). Empty values are skipped.
VARS=(
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  SUPABASE_SERVICE_ROLE_KEY
  ODDS_API_KEY
  OPENROUTER_API_KEY
  RESEND_API_KEY
  CRON_SECRET
  STRIPE_SECRET_KEY
  STRIPE_PRICE_ID
  STRIPE_WEBHOOK_SECRET
)

get_val() {
  grep "^$1=" .env.local | head -1 | cut -d= -f2- \
    | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

for target in production preview; do
  echo "── $target ──"
  for name in "${VARS[@]}"; do
    val="$(get_val "$name")"
    if [ -z "$val" ]; then echo "  skip $name (empty in .env.local)"; continue; fi
    $VC env rm "$name" "$target" -y >/dev/null 2>&1 || true
    if printf '%s' "$val" | $VC env add "$name" "$target" >/dev/null 2>&1; then
      echo "  set  $name"
    else
      echo "  FAIL $name"
    fi
  done
  # App URL must be the live domain, not localhost.
  $VC env rm NEXT_PUBLIC_APP_URL "$target" -y >/dev/null 2>&1 || true
  printf 'https://slippr.vercel.app' | $VC env add NEXT_PUBLIC_APP_URL "$target" >/dev/null 2>&1 \
    && echo "  set  NEXT_PUBLIC_APP_URL = https://slippr.vercel.app"
done

# Remove the old mis-named variables (missing _KEY) so they don't confuse things.
echo "── cleanup stale mis-named vars ──"
for bad in NEXT_PUBLIC_SUPABASE_ANON SUPABASE_SERVICE_ROLE RESEND_API; do
  for target in production preview development; do
    $VC env rm "$bad" "$target" -y >/dev/null 2>&1 && echo "  removed $bad ($target)" || true
  done
done

echo
echo "Done. Redeploy to apply:  npx vercel --prod"
