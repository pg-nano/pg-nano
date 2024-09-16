#! /bin/sh
set -e

if [ ! -d node_modules ]; then
  pnpm install --ignore-workspace pg-nano@latest @pg-nano/plugin-crud@latest
fi

pnpm dev
