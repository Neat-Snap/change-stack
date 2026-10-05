#!/bin/sh
set -eu
demo_source=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
demo_project=${1:-"$demo_source/project"}
if [ -e "$demo_project" ]; then
  printf 'Choose a new destination directory; it already exists: %s\n' "$demo_project" >&2
  exit 1
fi
mkdir -p "$demo_project"
cp -R "$demo_source/before/." "$demo_project/"
git -C "$demo_project" init -q
git -C "$demo_project" add .
git -C "$demo_project" -c user.name='Change Stack Demo' -c user.email='demo@example.invalid' commit -q -m 'Demo baseline'
cp -R "$demo_source/after/." "$demo_project/"
printf 'Demo project ready: %s\nOpen that directory in IntelliJ, load sample analysis, then enable Semantic Layers in the Commit changes tree.\n' "$demo_project"
