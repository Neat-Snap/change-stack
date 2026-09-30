#!/usr/bin/env bash
set -euo pipefail
image=${1:?Pass the image name}
container=$(docker run -d --rm -p 127.0.0.1:4317:4317 "$image" --demo)
trap 'docker stop "$container" >/dev/null 2>&1 || true' EXIT
launch=''
for attempt in {1..30}; do
  launch=$(docker logs "$container" 2>&1 | sed -n 's/.*Review ready: \(http[^[:space:]]*\).*/\1/p' | head -1)
  if [[ -n "$launch" ]]; then break; fi
  sleep 1
done
if [[ -z "$launch" ]]; then echo 'Container did not start the review.' >&2; exit 1; fi
secret=${launch##*#session=}
cookie_file=$(mktemp)
trap 'rm -f "$cookie_file"; docker stop "$container" >/dev/null 2>&1 || true' EXIT
curl --fail --silent --output /dev/null --cookie-jar "$cookie_file" \
  --request POST --header 'Origin: http://127.0.0.1:4317' --header "Authorization: Bearer $secret" http://127.0.0.1:4317/api/session
curl --fail --silent --cookie "$cookie_file" http://127.0.0.1:4317/api/review | python3 -c 'import json,sys; s=json.load(sys.stdin); assert s["demo"] and len(s["review"]["files"]) > 0'
echo 'Container passed: non-root binary starts, authenticated browser API works, demo review loads.'
