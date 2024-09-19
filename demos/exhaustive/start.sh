#! /bin/sh
set -e

if [ ! -d node_modules ]; then
  pnpm install --ignore-workspace pg-nano@latest @pg-nano/plugin-crud@latest @pg-nano/plugin-typebox@latest @sinclair/typebox@^0.33.12
fi

pnpm dev
