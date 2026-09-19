#!/bin/sh
# Runs the production build the supported way for `output: "standalone"`:
# the self-contained server in .next/standalone, not `next start` (which warns
# that it does not work with standalone output). Used by the CI end-to-end job
# and for a production-like run on a laptop; the container image does the same
# thing in apps/web/Dockerfile.
#
#   pnpm --filter web build && pnpm --filter web start:standalone
#
# PORT (default 3100) and HOST (default 0.0.0.0) choose where it listens.
# HOST, not HOSTNAME: shells and containers set HOSTNAME to the machine name.
set -eu

cd "$(dirname "$0")/.."

server=.next/standalone/apps/web/server.js
if [ ! -f "$server" ]; then
  echo "No standalone build found. Run: pnpm --filter web build" >&2
  exit 1
fi

# The standalone bundle leaves these out on purpose (a CDN may serve them), so
# they are copied next to the server, as the Dockerfile does.
rm -rf .next/standalone/apps/web/.next/static .next/standalone/apps/web/public
cp -R .next/static .next/standalone/apps/web/.next/static
cp -R public .next/standalone/apps/web/public

# The standalone server changes into its own directory and does not read
# apps/web/.env.local, so Node loads it here. Variables that are already set
# win over the file, and Node's parser copes with values a shell would not
# (MAIL_FROM contains spaces and angle brackets).
PORT="${PORT:-3100}" HOSTNAME="${HOST:-0.0.0.0}" \
  exec node --env-file-if-exists=.env.local "$server"
