# Isolated backend contracts

`tools/lab/run_isolated_backend_tests.py` runs the API tests without the deployed stack or `.lab-ci/run.sh`. It requires Python 3, Git, Docker, and these local images:

| Option             | Default image                      | Requirement                                                               |
| ------------------ | ---------------------------------- | ------------------------------------------------------------------------- |
| `--test-image`     | `ooa-plane-finance-tests:20261011` | Python and `apps/api/requirements/test.txt` installed; `pytest` available |
| `--postgres-image` | `postgres:15.7-alpine`             | PostgreSQL with `pg_isready`                                              |
| `--redis-image`    | `valkey/valkey:7.2.11-alpine`      | Valkey with `valkey-cli`                                                  |
| `--minio-image`    | `ooa-plane-minio:source`           | MinIO and `mc`; built by `tools/lab/Dockerfile.minio`                     |

The script never pulls or builds images automatically. Options go **before** `up`, `run`, or `down`; pytest arguments go after `run` (an optional `--` separator is accepted).

```sh
# The root is located from the script, so the current directory does not matter.
# Choose a separate prefix for each parallel suite or checkout.
python3 tools/lab/run_isolated_backend_tests.py --prefix plane-lab-tests-my-review up

# Defaults to the laboratory contracts if no pytest arguments are supplied.
python3 tools/lab/run_isolated_backend_tests.py --prefix plane-lab-tests-my-review run \
  plane/tests/contract/api/lab --junitxml=/artifacts/lab.xml

python3 tools/lab/run_isolated_backend_tests.py --prefix plane-lab-tests-my-review run \
  plane/tests/contract/api/lab/test_agent_thread_races.py

# Removes only resources labelled for this exact prefix and checkout.
python3 tools/lab/run_isolated_backend_tests.py --prefix plane-lab-tests-my-review down
```

`run` also performs `up` when needed. It forwards pytest's exit code. Actual database migrations are enabled with `--migrations -o addopts=`; the repository's default `--nomigrations` is not inherited. `--reuse-db` keeps the test database between runs with the same prefix. The first invocation can take several minutes for migrations. A prefix permits one active runner; use another prefix for parallel runs.

The default prefix includes a hash of the checkout path. The default artifact directory is `.artifacts/isolated-backend/<prefix>/`, mounted at `/artifacts`. `--artifacts /absolute/empty/directory` selects a different directory. An existing nonempty artifact directory is accepted only with this harness's matching ownership marker; this prevents inadvertently mounting an unrelated host directory. Artifacts survive `down`.

## Isolation and lifecycle

- The Docker bridge is internal. No service publishes a host port. PostgreSQL, Redis and MinIO use tmpfs; `down` permanently discards their test data.
- Every network/container has ownership, prefix and checkout labels. A colliding unlabelled resource, unexpected service network/mount, or foreign container attached to the network causes a refusal. Cleanup uses inspected immutable IDs and never uses `prune` or Compose project names.
- The runner mounts a temporary API source snapshot, read-only. It copies tracked and nonignored untracked files from Git, excluding `.env*`, key files and runtime/dependency directories; it rejects source symlinks. It never mounts the live checkout. Save new tests as ordinary nonignored files before running them.
- `env -i` clears image defaults. Database, cache, object storage, SMTP, Celery and provider settings are supplied explicitly with test-only values. LLM keys are blank, provider URLs are invalid, and no shell `.env`, production configuration or Docker production container configuration is read. Celery uses the in-process memory transport.
- The laboratory fixture creates lead, member, reviewer and independent roles in the isolated database. No preconfigured live accounts are required.
- Use `down` after a failed run or interruption too. If cleanup reports foreign resources, inspect the collision; do not remove unrelated resources to make the command pass.

## Preparing images on a new machine

Existing trusted images can be selected with the options above. To build a dependency-only API test image without sending application configuration to Docker, use the requirements directory as the entire build context:

```sh
docker build -t plane-lab-tests:local -f - apps/api/requirements <<'DOCKERFILE'
FROM python:3.12.10-slim
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*
COPY . /requirements/
RUN pip install --no-cache-dir -r /requirements/test.txt
WORKDIR /code
DOCKERFILE

python3 tools/lab/run_isolated_backend_tests.py --test-image plane-lab-tests:local run
```

The optional image build needs package network access. It is separate from the offline test network; it was not needed for the verified run, which reused the local image. PostgreSQL and Valkey must likewise be present locally. To prepare the repository's MinIO image with an empty context:

```sh
lab_minio_context=$(mktemp -d)
docker build -f tools/lab/Dockerfile.minio -t ooa-plane-minio:source "$lab_minio_context"
rmdir "$lab_minio_context"
```

The runner was verified with a new prefix using real migrations and two synthetic contracts (finance read permissions and restored AI thread context), followed by cleanup of that prefix alone.
