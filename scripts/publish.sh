#!/usr/bin/env bash
# Dynamic publish script — discovers packages from release-please-config.json.
# Publishes each package that was released by release-please.
#
# Expects RELEASES env var containing the JSON output from
# googleapis/release-please-action (all step outputs as JSON).
#
# Usage:
#   RELEASES='{"packages/pi-foo--release_created":"true",...}' ./scripts/publish.sh
#   RELEASES='...' ./scripts/publish.sh --dry-run

set -euo pipefail

if [ -z "${RELEASES:-}" ]; then
  echo "Error: RELEASES env var is required" >&2
  exit 1
fi

# Ensure we're running from the repo root
if [ ! -f release-please-config.json ]; then
  echo "Error: release-please-config.json not found. Run this script from the repo root." >&2
  exit 1
fi

DRY_RUN=""
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN="--dry-run"
  echo "Dry-run mode: packages will not be published"
fi

# Discover package paths from release-please-config.json
paths=$(jq -r '.packages | keys[]' release-please-config.json)

published=0
failed=0

while IFS= read -r path; do
  released=$(echo "$RELEASES" | jq -r ".\"${path}--release_created\" // \"false\"")
  if [ "$released" = "true" ]; then
    # Read the package name from the package's own package.json
    filter=$(jq -r '.name' "$path/package.json")
    echo "::group::Publishing $filter"
    if pnpm --filter "$filter" publish --access public --no-git-checks --provenance $DRY_RUN; then
      echo "Successfully published $filter"
      published=$((published + 1))
    else
      echo "::warning::Failed to publish $filter"
      failed=$((failed + 1))
    fi
    echo "::endgroup::"
  fi
done <<< "$paths"

echo ""
echo "Summary: $published published, $failed failed"

if [ "$failed" -gt 0 ]; then
  exit 1
fi
