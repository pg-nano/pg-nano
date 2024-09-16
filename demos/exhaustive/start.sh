#! /bin/sh
set -e

if [ ! -d node_modules ]; then
  # Replace "workspace:" specifiers with latest versions.a
  pnpm up --workspace

  # Prevent pnpm from installing other packages in the monorepo.
  touch pnpm-workspace.yaml

  pnpm install
fi

pnpm dev
