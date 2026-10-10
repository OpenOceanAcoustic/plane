#!/usr/bin/env bash
set -euo pipefail
export RAYON_NUM_THREADS=1
export ROLLDOWN_WORKER_THREADS=4
export ROLLDOWN_MAX_BLOCKING_THREADS=4
export TURBO_TELEMETRY_DISABLED=1
lab_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$lab_root"
profile=lab
if [[ "${1:-}" == --profile ]]; then
  profile="${2:-}"
  shift 2
fi
case "$profile" in
  lab)
    compose=(docker compose -p "${LAB_COMPOSE_PROJECT:-ooa-plane-lab}" -f compose.lab.yml)
    # Keep the running instance on its published assets during isolated builds.
    if [[ "${LAB_COMPOSE_PROJECT:-ooa-plane-lab}" == "ooa-plane-lab" && -f .temp/lab-runtime/compose.proxy.yml ]]; then
      compose+=(-f .temp/lab-runtime/compose.proxy.yml)
    fi
    ;;
  public) compose=(docker compose --env-file .env.public -p "${PUBLIC_COMPOSE_PROJECT:-ooa-plane-public}" -f compose.public.yml) ;;
  *) echo 'Unknown profile; choose lab or public' >&2; exit 2 ;;
esac
case "${1:-help}" in
  setup) shift; python3 tools/lab/setup.py --profile "$profile" "$@" ;;
  build)
    if [[ "$profile" == public ]]; then
      "${compose[@]}" build
      exit
    fi
    pnpm turbo run build --filter='web^...' --filter='admin^...' --filter='space^...' --filter='live^...' --concurrency=1
    pnpm --filter web build
    pnpm --filter admin build
    pnpm --filter space build
    pnpm --filter live build
    "${compose[@]}" build plane-minio
    "${compose[@]}" build api
    ;;
  init)
    "${compose[@]}" up -d plane-db plane-redis plane-mq plane-minio
    "${compose[@]}" run --rm api python manage.py migrate
    "${compose[@]}" run --rm api python manage.py register_instance local-lab
    "${compose[@]}" run --rm api python manage.py configure_instance
    "${compose[@]}" run --rm api python manage.py create_bucket
    if [[ "$profile" == lab ]]; then
      "${compose[@]}" run --rm api python manage.py collectstatic --noinput
    fi
    ;;
  start)
    "${compose[@]}" up -d --no-build
    # Reattach rebuilt client directories and reload Space's server bundle.
    if [[ "$profile" == lab ]]; then
      "${compose[@]}" up -d --no-build --no-deps --force-recreate proxy space
    fi
    ;;
  stop) "${compose[@]}" stop ;;
  status) "${compose[@]}" ps ;;
  access) shift; "${compose[@]}" exec -T api python manage.py lab_access "$@" ;;
  backup) shift; python3 tools/lab/backup.py --profile "$profile" backup "$@" ;;
  restore-verify) shift; python3 tools/lab/backup.py --profile "$profile" restore-verify "$@" ;;
  check)
    python3 tools/lab/test_runtime_mounts.py
    node tools/lab/test-calendar.mjs
    node tools/lab/test-planning-store.mjs
    node tools/lab/test-fields-gantt.mjs
    node tools/lab/test-workflow.mjs
    pnpm turbo run check:types check:lint --filter=web --filter=admin --filter=space --filter=@plane/ui --filter=@plane/shared-state --filter=@plane/types --concurrency=1
    "${compose[@]}" exec -T api python manage.py check
    "${compose[@]}" exec -T api python manage.py makemigrations --check --dry-run lab
    "${compose[@]}" exec -T api python - < tools/lab/test_upload.py
    ;;
  *) echo 'Usage: tools/lab/lab.sh [--profile lab|public] setup|build|init|start|stop|status|access|backup|restore-verify|check <options>' ;;
esac
