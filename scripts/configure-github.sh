#!/usr/bin/env bash
set -euo pipefail
repo=sbadulin/pilot-archive
# Run after main exists and CI has run at least once.
gh repo edit "$repo" --delete-branch-on-merge --enable-squash-merge --disable-merge-commit --disable-rebase-merge
for environment in selectel-production cloudflare-production; do
  gh api --method PUT "repos/$repo/environments/$environment" --input deploy/github-environment.json >/dev/null
done
gh api --method PUT "repos/$repo/branches/main/protection" --input deploy/github-protection.json >/dev/null
printf '%s\n' 'GitHub environments and main protection configured.'
