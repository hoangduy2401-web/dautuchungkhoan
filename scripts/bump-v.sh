#!/bin/bash
# Bump the cache-busting ?v=YYYYMMDD<letter> on every page in ONE step.
#
# Why: GitHub Pages serves JS/CSS with max-age=600, so a changed file keeps
# running from cache for up to 10 minutes unless its ?v= changes, and the
# pages share files (base.css, store.js, nav.js...) — bumping one page and not
# the others has already cost debugging rounds (CLAUDE.md §2, §4).
#
# Next version: same day -> next letter (20260926a -> 20260926b);
#               new day  -> <today>a.
# Usage (from the repo root or anywhere):  bash scripts/bump-v.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PAGES=(index.html chung-khoan.html coin.html ngoai-te.html tiet-kiem.html vang.html)

current=$(grep -ho '?v=[0-9]\{8\}[a-z]' "${PAGES[@]}" | sort -u)
if [ "$(printf '%s\n' "$current" | wc -l | tr -d ' ')" != "1" ]; then
  echo "Pages disagree on ?v= — fix by hand first:" >&2
  grep -o '?v=[0-9]\{8\}[a-z]' "${PAGES[@]}" | sort | uniq -c >&2
  exit 1
fi
old=${current#?v=}
today=$(TZ=Asia/Ho_Chi_Minh date +%Y%m%d)

if [ "${old:0:8}" = "$today" ]; then
  letter=${old:8:1}
  if [ "$letter" = "z" ]; then echo "Already at ${old} — out of letters for today" >&2; exit 1; fi
  new="${today}$(echo "$letter" | tr 'a-y' 'b-z')"
else
  new="${today}a"
fi

sed -i '' "s/?v=${old}/?v=${new}/g" "${PAGES[@]}"
count=$(grep -o "?v=${new}" "${PAGES[@]}" | wc -l | tr -d ' ')
echo "?v=${old} -> ?v=${new} (${count} chỗ trong ${#PAGES[@]} trang)"
