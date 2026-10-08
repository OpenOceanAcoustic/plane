#!/bin/sh
# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
set -eu

backend_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)

case "${1:-}" in
  -h|--help|help)
    cat <<'HELP'
Usage: sh backend.sh [bootstrap|invite|reset|revoke|list|purge] [options]

sh backend.sh                                  # 首次管理员：输出一次性注册链接
sh backend.sh invite --workspace openoceanacoustic --role 15
sh backend.sh reset --username MEMBER_USERNAME
sh backend.sh revoke --id INVITATION_UUID
sh backend.sh list

链接默认有效期为 24 小时，绑定成功后失效；仅在服务器终端发放。
HELP
    exit 0
    ;;
esac

if [ "$#" -eq 0 ]; then
  set -- bootstrap
fi

exec "$backend_root/tools/lab/lab.sh" access "$@"
