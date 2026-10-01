#!/usr/bin/env bash
# Scans the project for credentials before you commit or deploy.
#
#   bash scripts/check-secrets.sh
#
# Exits 1 if anything is found, so it also works as a pre-commit hook:
#   ln -s ../../scripts/check-secrets.sh .git/hooks/pre-commit
#
# Written for bash 3.2 (the version macOS ships) — no associative arrays.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

# Parallel arrays: LABELS[i] describes PATTERNS[i].
LABELS=(
  "Gemini key (new AQ. format)"
  "Google API key (legacy AIza)"
  "Google OAuth client secret"
  "AWS access key"
  "OpenAI key"
  "Generic bearer token"
  "Private key block"
)
PATTERNS=(
  'AQ\.[A-Za-z0-9_-]{30,}'
  'AIza[A-Za-z0-9_-]{30,}'
  'GOCSPX-[A-Za-z0-9_-]{20,}'
  'AKIA[0-9A-Z]{16}'
  'sk-[A-Za-z0-9]{32,}'
  '[Bb]earer [A-Za-z0-9_.=-]{25,}'
  'BEGIN [A-Z ]*PRIVATE KEY'
)

# .dev.vars is *meant* to hold the key locally; never flag it.
EXCLUDES=(
  --exclude=.dev.vars
  --exclude=check-secrets.sh
  --exclude-dir=.git
  --exclude-dir=node_modules
  --exclude-dir=.wrangler
)

echo "Scanning $(pwd)"
echo

fail=0
i=0
while [ "$i" -lt "${#LABELS[@]}" ]; do
  label="${LABELS[$i]}"
  pat="${PATTERNS[$i]}"
  hits=$(grep -rInE "${EXCLUDES[@]}" -- "$pat" . 2>/dev/null)
  if [ -n "$hits" ]; then
    echo "  x  $label"
    echo "$hits" | cut -c1-150 | sed 's/^/       /'
    fail=1
  else
    echo "  ok clean — $label"
  fi
  i=$((i + 1))
done

echo

# The local secrets file must never be tracked by git.
if git rev-parse --git-dir >/dev/null 2>&1; then
  tracked=$(git ls-files 2>/dev/null | grep -E '^\.dev\.vars$|^\.env' )
  if [ -n "$tracked" ]; then
    echo "  x  secret file tracked by git: $tracked"
    fail=1
  else
    echo "  ok no secret files tracked by git"
  fi
else
  echo "  -  git not initialised yet (skipping tracked-file check)"
fi

# Sanity-check .dev.vars itself without ever printing the value.
if [ -f .dev.vars ]; then
  val=$(awk -F'=' '/^GEMINI_KEY=/{sub(/^GEMINI_KEY=/,""); print; exit}' .dev.vars)
  n=${#val}
  case "$val" in
    "")                       echo "  x  .dev.vars — GEMINI_KEY is empty";       fail=1 ;;
    *" "*|*"&&"*|*"pbpaste"*|*"/"*)
                              echo "  x  .dev.vars — that's a shell command, not a key"; fail=1 ;;
    *"ჩასვი"*|*"paste-your"*) echo "  x  .dev.vars — still the placeholder";     fail=1 ;;
    AQ.*)                    echo "  ok .dev.vars — key present (AQ. format, $n chars)" ;;
    AIza*)                   echo "  ok .dev.vars — key present (legacy format, $n chars)" ;;
    *)                       echo "  ?  .dev.vars — unrecognised format ($n chars)" ;;
  esac
else
  echo "  -  .dev.vars not created yet"
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "PASS — nothing to leak."
else
  echo "FAIL — fix the items marked x above."
fi
exit "$fail"
