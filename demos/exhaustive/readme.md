Try `pg-nano` out for yourself with this exhaustive demo.

### Project structure

- See the `./sql/` directory for the SQL schema and the generated TypeScript definitions.
- See the `./test.ts` module for sample client usage.

### Pre-requisites

- [pnpm](https://pnpm.io/installation)
- [postgres](https://www.postgresql.org/download/)

### Setup

First, you need to start a Postgres instance. You have the option of running it on your local machine, or using a Docker container.

- **Local Postgres**:
  - Make sure the local port is 54322 (or change the port in the `pg-nano.config.ts` file).

- **Docker**:
  - Run `docker compose up` from this directory to start a Postgres container in the foreground.
  - Open another terminal for the next step.

---

Next, let's set up the Node.js project.

```sh
git clone https://github.com/pg-nano/pg-nano.git
cd pg-nano
```

You have the option of installing `pg-nano` from NPM, or using the local version in this repository. If you plan to edit `pg-nano` locally or you want to try unreleased changes, you should use the local `pg-nano` version.

- **Local version**:
  - Prepare the local `pg-nano` version:
    ```sh
    git submodule update --init --recursive
    pnpm install
    pnpm build
    ```
  - Prepare the demo project:
    ```sh
    cd demos/exhaustive
    pnpm install
    ```
  - Start the `pg-nano` file watcher:
    ```sh
    pnpm dev
    ```

- **NPM version**:
  - Start the `pg-nano` file watcher:
    ```sh
    cd demos/exhaustive
    pnpm start
    ```
  - On the first run, the `start` script will also install `pg-nano` from NPM.

---

Finally, run the test script to verify that everything is working correctly. You can edit the `test.ts` file to experiment with different queries. As you make changes, the watcher will automatically re-run the test script.

```sh
pnpm test
```

That's it! If you run into any issues, please [file an issue](https://github.com/pg-nano/pg-nano/issues/new) or send me a DM on Discord (@aleclarson).
