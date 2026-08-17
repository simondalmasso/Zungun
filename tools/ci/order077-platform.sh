#!/usr/bin/env bash
set -euo pipefail
: "${START_SHA:?}"
: "${CANDIDATE_SUBTREE:?}"

browser="$(command -v chromium || command -v chromium-browser || command -v google-chrome-stable || command -v google-chrome || true)"
test -n "$browser"
python tools/browser/control-room-e2e.py | tee control-room-e2e.json
jq -e '.ok == true and .backendPagination == true and .globalTotals == 26' control-room-e2e.json

docker build -f infra/docker/receiver.Dockerfile -t zungun-receiver:order077 .
ingest='container-ingest-token-order077'; reader='container-reader-token-order077'
worker='container-worker-token-order077'; reviewer='container-reviewer-token-order077'; admin='container-admin-token-order077'
principals="$(jq -cn --arg i "$ingest" --arg r "$reader" --arg w "$worker" --arg v "$reviewer" --arg a "$admin" '[{subject:"ci-ingest",token:$i,roles:["ingest"]},{subject:"ci-reader",token:$r,roles:["reader"]},{subject:"ci-worker",token:$w,roles:["worker"]},{subject:"ci-reviewer",token:$v,roles:["reviewer"]},{subject:"ci-admin",token:$a,roles:["admin"]}]')"
docker run -d --name zungun-order077 --read-only --tmpfs /tmp:rw,nosuid,size=64m,mode=1777 \
  -e ZUNGUN_PRINCIPALS_JSON="$principals" -e RECEIVER_DB=/tmp/receiver.sqlite \
  -e RECEIVER_KEY_FILE=/tmp/key.json -p 18789:8788 zungun-receiver:order077
cleanup() { docker rm -f zungun-order077 >/dev/null 2>&1 || true; }
trap cleanup EXIT
ready=0
for _ in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:18789/ready >/dev/null; then ready=1; break; fi
  sleep 1
done
test "$ready" = 1
curl -fsS -H "Authorization: Bearer $reader" 'http://127.0.0.1:18789/api/v1/operations?limit=1' | jq -e '.items | type == "array"'
code="$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H "Authorization: Bearer $reader" -H 'content-type: application/json' -d '{}' http://127.0.0.1:18789/api/v1/operations)"
test "$code" = 403
docker image inspect zungun-receiver:order077 > image-inspect.json
cleanup
trap - EXIT

cp .github/evidence/order-073/canary-package-lock.order057.json canary/zep-core-canary/package-lock.json
(cd canary/zep-core-canary && npm ci --ignore-scripts --no-audit --no-fund && npm run verify)
historical="$RUNNER_TEMP/order077-historical"
git worktree add --detach "$historical" "$START_SHA"
trap 'git worktree remove --force "$historical" >/dev/null 2>&1 || true' EXIT
cp .github/evidence/order-073/canary-package-lock.order057.json "$historical/canary/zep-core-canary/package-lock.json"
(cd "$historical/canary/zep-core-canary" && npm ci --ignore-scripts --no-audit --no-fund && npm run verify)
export PATH="$historical/canary/zep-core-canary/node_modules/.bin:$PATH"
(cd "$historical/candidate/order-072" && npm ci --ignore-scripts --no-audit --no-fund && npm run verify:deep)
test "$(git -C "$historical" rev-parse HEAD:candidate/order-072)" = "$CANDIDATE_SUBTREE"
git worktree remove --force "$historical"
trap - EXIT
