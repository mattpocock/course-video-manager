#!/bin/bash
set -eo pipefail

# ============================================================
# RALPH GitHub Actions Setup
# ============================================================
#
# This script walks you through setting up the two secrets
# needed for the agent-implement.yml workflow.
#
# Secrets required:
#
#   1. CLAUDE_CODE_OAUTH_TOKEN
#      Your Claude Code OAuth token. Claude Code uses this
#      to authenticate with the Anthropic API on the runner.
#
#      To get it:
#        - Open Claude Code locally
#        - Run: claude config get oauthToken
#        - Copy the token value
#
#   2. GH_READ_TOKEN
#      A GitHub Personal Access Token (classic) scoped to
#      read issues. Claude uses this inside the runner to
#      fetch issue bodies and comments via `gh issue view`.
#
#      To create one:
#        - Go to https://github.com/settings/tokens
#        - Click "Generate new token (classic)"
#        - Name: "RALPH read token"
#        - Scopes: check ONLY `repo` (needed for private
#          repo issue reads; for public repos `public_repo`
#          is sufficient)
#        - Click "Generate token"
#        - Copy the token
#
#   Note: The workflow also uses the built-in GITHUB_TOKEN
#   (provided automatically by GitHub Actions) for pushing
#   branches and creating PRs. No setup needed for that.
#
# ============================================================

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)

if [ -z "$REPO" ]; then
  echo "Error: Could not determine repo. Make sure you're in a git repo with a GitHub remote."
  exit 1
fi

echo "Setting up secrets for: $REPO"
echo ""

# --- CLAUDE_CODE_OAUTH_TOKEN ---

echo "Step 1: CLAUDE_CODE_OAUTH_TOKEN"
echo ""
echo "  This is your Claude Code OAuth token."
echo "  To find it, run:  claude config get oauthToken"
echo ""

EXISTING=$(gh secret list --repo "$REPO" 2>/dev/null | grep "CLAUDE_CODE_OAUTH_TOKEN" || true)
if [ -n "$EXISTING" ]; then
  echo "  [Already set] CLAUDE_CODE_OAUTH_TOKEN exists. Overwrite? (y/N)"
  read -r OVERWRITE
  if [[ "$OVERWRITE" != "y" && "$OVERWRITE" != "Y" ]]; then
    echo "  Skipping."
    echo ""
  else
    echo "  Paste your CLAUDE_CODE_OAUTH_TOKEN (input is hidden):"
    read -rs TOKEN
    echo "$TOKEN" | gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo "$REPO"
    echo "  Set."
    echo ""
  fi
else
  echo "  Paste your CLAUDE_CODE_OAUTH_TOKEN (input is hidden):"
  read -rs TOKEN
  echo "$TOKEN" | gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo "$REPO"
  echo "  Set."
  echo ""
fi

# --- GH_READ_TOKEN ---

echo "Step 2: GH_READ_TOKEN"
echo ""
echo "  This is a GitHub PAT (classic) for reading issues."
echo "  Create one at: https://github.com/settings/tokens"
echo "  Required scope: repo (or public_repo for public repos)"
echo ""

EXISTING=$(gh secret list --repo "$REPO" 2>/dev/null | grep "GH_READ_TOKEN" || true)
if [ -n "$EXISTING" ]; then
  echo "  [Already set] GH_READ_TOKEN exists. Overwrite? (y/N)"
  read -r OVERWRITE
  if [[ "$OVERWRITE" != "y" && "$OVERWRITE" != "Y" ]]; then
    echo "  Skipping."
    echo ""
  else
    echo "  Paste your GH_READ_TOKEN (input is hidden):"
    read -rs TOKEN
    echo "$TOKEN" | gh secret set GH_READ_TOKEN --repo "$REPO"
    echo "  Set."
    echo ""
  fi
else
  echo "  Paste your GH_READ_TOKEN (input is hidden):"
  read -rs TOKEN
  echo "$TOKEN" | gh secret set GH_READ_TOKEN --repo "$REPO"
  echo "  Set."
  echo ""
fi

# --- Verify ---

echo "============================================================"
echo "Secrets configured for $REPO:"
echo ""
gh secret list --repo "$REPO"
echo ""
echo "============================================================"
