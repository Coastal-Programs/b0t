#!/usr/bin/env bash
# impl: playwright
# Screenshot any URL. Works for any web framework (Next/Vite/Rails/Django/etc.) —
# it only needs an HTTP server.
#
# Usage:
#   visual.sh <url> [viewport WxH] [--selector <css>] [--wait-for-selector <css>] [--full-page|--viewport-only]
#
# Prints the absolute PNG path to stdout.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/_lib.sh"

URL="${1:-}"
[ -z "$URL" ] && eyes_die "usage: visual.sh <url> [WxH] [--selector css] [--wait-for-selector css] [--full-page|--viewport-only]"
shift

VIEWPORT="1280,800"
FULLPAGE="--full-page"
SELECTOR=""
WAIT_SELECTOR=""

# Accept either WxH or W,H as second positional arg
if [ "$#" -gt 0 ] && [[ "$1" =~ ^[0-9]+[x,][0-9]+$ ]]; then
  VIEWPORT="${1/x/,}"
  shift
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --selector) SELECTOR="$2"; shift 2;;
    --wait-for-selector) WAIT_SELECTOR="$2"; shift 2;;
    --full-page) FULLPAGE="--full-page"; shift;;
    --viewport-only) FULLPAGE=""; shift;;
    *) eyes_die "unknown arg: $1";;
  esac
done

eyes_require npx

OUT="$(eyes_out_dir)/screenshot-$(eyes_timestamp).png"
ARGS=(playwright screenshot --browser=chromium --viewport-size="$VIEWPORT" --wait-for-timeout=1500)
[ -n "$FULLPAGE" ] && ARGS+=("$FULLPAGE")
[ -n "$WAIT_SELECTOR" ] && ARGS+=(--wait-for-selector "$WAIT_SELECTOR")

# --selector limits to one element
if [ -n "$SELECTOR" ]; then
  # Playwright CLI doesn't take a CSS selector for element-only screenshots,
  # so when --selector is used we fall back to a tiny node script.
  eyes_timeout 45 npx --yes -p playwright@latest node -e '
    const { chromium } = require("playwright");
    const [,, url, viewport, selector, out] = process.argv;
    const [w, h] = viewport.split(",").map(Number);
    (async () => {
      const b = await chromium.launch();
      const ctx = await b.newContext({ viewport: { width: w, height: h } });
      const p = await ctx.newPage();
      await p.goto(url, { waitUntil: "networkidle", timeout: 20000 });
      const el = await p.waitForSelector(selector, { timeout: 15000 });
      await el.screenshot({ path: out });
      await b.close();
    })().catch(e => { console.error(e.message); process.exit(1); });
  ' "$URL" "$VIEWPORT" "$SELECTOR" "$OUT" >&2 || eyes_die "playwright element screenshot failed"
else
  eyes_timeout 45 npx --yes -p playwright@latest playwright "${ARGS[@]}" "$URL" "$OUT" >&2 \
    || eyes_die "playwright screenshot failed (is the server running at $URL?)"
fi

[ -s "$OUT" ] || eyes_die "screenshot empty: $OUT"
echo "$OUT"
