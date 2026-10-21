#!/usr/bin/env bash
set -euo pipefail
cd /mnt/repo/kanban/plane
PROJECT="${LAB_COMPOSE_PROJECT:-ooa-plane-lab}"
docker compose -p "$PROJECT" -f compose.lab.yml exec -T api python manage.py lab_ai_reminders
