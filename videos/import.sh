#!/usr/bin/env bash
# Importe une liste de vidéos (JSON) : source HLS/MP4 → MP4 → Bunny Stream → leçon dans l'app
set -euo pipefail
LIST="$1"; KEYS="videos/keys.json"
LIB=$(jq -r .bunny_library "$KEYS"); KEY=$(jq -r .bunny_api_key "$KEYS")
SB=$(jq -r .supabase_url "$KEYS"); ANON=$(jq -r .supabase_anon "$KEYS"); IK=$(jq -r .import_key "$KEYS")
OUT="videos/done-$(basename "$LIST")"; echo "[]" > "$OUT"
n=$(jq length "$LIST")
for i in $(seq 0 $((n-1))); do
  title=$(jq -r ".[$i].title" "$LIST"); url=$(jq -r ".[$i].url" "$LIST"); lesson=$(jq -r ".[$i].lesson_id // empty" "$LIST")
  echo "=== [$((i+1))/$n] $title"
  f="/tmp/v$i.mp4"
  ffmpeg -loglevel error -y -i "$url" -c copy -bsf:a aac_adtstoasc -movflags +faststart "$f"
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" | awk '{m=int($1/60); s=int($1%60+0.5); printf "%d:%02d", m, s}')
  size=$(stat -c %s "$f"); echo "mp4 prêt : $dur, $((size/1024/1024)) Mo"
  guid=$(curl -sS -X POST "https://video.bunnycdn.com/library/$LIB/videos" -H "AccessKey: $KEY" -H "Content-Type: application/json" -d "{\"title\":$(jq -Rn --arg t "$title" '$t')}" | jq -r .guid)
  echo "bunny guid : $guid"
  curl -sS -X PUT "https://video.bunnycdn.com/library/$LIB/videos/$guid" -H "AccessKey: $KEY" -H "Content-Type: application/octet-stream" --data-binary "@$f" -o /dev/null -w "upload : HTTP %{http_code}\n"
  embed="https://iframe.mediadelivery.net/embed/$LIB/$guid"
  if [ -n "$lesson" ]; then
    curl -sS -X POST "$SB/rest/v1/rpc/import_lesson_video?apikey=$ANON" -H "Content-Type: application/json" \
      -d "{\"p_lesson\":$lesson,\"p_url\":\"$embed\",\"p_duration\":\"$dur\",\"p_key\":\"$IK\"}" -w "\nleçon $lesson : HTTP %{http_code}\n"
  fi
  jq --arg t "$title" --arg g "$guid" --arg e "$embed" --arg d "$dur" --argjson l "${lesson:-null}" '. + [{title:$t, guid:$g, embed:$e, duration:$d, lesson_id:$l}]' "$OUT" > "$OUT.tmp" && mv "$OUT.tmp" "$OUT"
  rm -f "$f"
done
cat "$OUT"
