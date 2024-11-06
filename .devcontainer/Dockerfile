FROM mcr.microsoft.com/devcontainers/typescript-node:22

ENV SHELL=/bin/bash

RUN apt-get update && apt-get install -y golang libpq-dev=15.*

RUN curl -fsSL https://get.pnpm.io/install.sh | sh -
