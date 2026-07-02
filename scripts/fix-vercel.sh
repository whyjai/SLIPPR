#!/bin/bash
# One-time fix: links SLIPPR to Vercel and deploys without re-typing env vars.
set -e

cd "$(dirname "$0")/.."

echo "→ Login to Vercel (browser opens once)"
npx vercel@latest login

echo ""
echo "→ Link to your EXISTING project (the one with env vars already set)"
echo "  Pick the project name from the list — do NOT create a new one."
npx vercel@latest link

echo ""
echo "→ Deploy to production"
npx vercel@latest deploy --prod

echo ""
echo "✅ Done. Open the URL printed above."
