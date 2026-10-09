# Copyright (c) 2026 OpenOceanAcoustic and contributors
# SPDX-License-Identifier: AGPL-3.0-only
"""Bounded, atomic admission before expensive authentication and API work."""

import hashlib
import ipaddress
import json
import logging
import threading
import time
from functools import lru_cache

import redis
from django.conf import settings
from django.http import JsonResponse
from redis.exceptions import RedisError
from rest_framework.exceptions import APIException
from rest_framework.throttling import BaseThrottle

logger = logging.getLogger("plane.security")
_log_counts = {}
_log_lock = threading.Lock()

# Check every budget before allocating any key. A rejected random source therefore
# cannot grow Redis state; global admission bounds the number of source keys.
_ADMIT = """
local retry = 0
for i, key in ipairs(KEYS) do
  local count = tonumber(redis.call('GET', key) or '0')
  if count >= tonumber(ARGV[i]) then
    retry = math.max(retry, redis.call('TTL', key), 1)
  end
end
if retry > 0 then return retry end
for i, key in ipairs(KEYS) do
  local count = redis.call('INCR', key)
  if count == 1 then redis.call('EXPIRE', key, 60) end
end
return 0
"""


@lru_cache(maxsize=4)
def _redis(url):
    return redis.Redis.from_url(url, socket_connect_timeout=0.3, socket_timeout=0.3)


def client_ip(request):
    """Only the explicitly trusted proxy may supply a forwarding chain."""
    raw = request.META.get("REMOTE_ADDR", "")
    try:
        peer = ipaddress.ip_address(raw)
        trusted = [ipaddress.ip_network(value) for value in settings.TRUSTED_PROXY_CIDRS]
        if any(peer in network for network in trusted):
            chain = request.META.get("HTTP_X_FORWARDED_FOR", "").split(",")
            for value in reversed(chain):
                candidate = ipaddress.ip_address(value.strip())
                if not any(candidate in network for network in trusted):
                    return str(candidate)
        return str(peer)
    except ValueError:
        return "invalid"


def security_event(request, event, **details):
    # Aggregate by event only: usernames/IPs cannot allocate counter keys.
    # Only attack failures are sampled; successful authentication and revocation
    # must remain visible even when preceded by a flood of rejected requests.
    bucket = int(time.time() // 60)
    with _log_lock:
        if _log_counts.get("bucket") != bucket:
            _log_counts.clear()
            _log_counts["bucket"] = bucket
        key = event if len(_log_counts) < 64 or event in _log_counts else "other"
        count = _log_counts.get(key, 0) + 1
        _log_counts[key] = count
    sample = details.get("result") not in (None, "success") or event.endswith((".rejected", ".denied"))
    if sample and count > 10 and count & (count - 1):
        return
    # Never serialize arbitrary bodies, cookie values, OTPs or invitation tokens.
    allowed = {"purpose", "reason", "user_id", "device_id", "result", "username_hash"}
    record = {
        "event": event,
        "count_in_minute": count,
        "ip": client_ip(request),
        "method": request.method,
        "path": request.path,
        **{key: str(value) for key, value in details.items() if key in allowed},
    }
    logger.info(json.dumps(record, ensure_ascii=False, separators=(",", ":")))


def _access_error(message, status, code, retry_after=None):
    from .auth import AccessError

    error = AccessError(message, status, retry_after)
    error.code = code
    return error


def admit(budgets):
    if not settings.LAB_SECURITY_LIMITS_ENABLED:
        return
    prefix = settings.LAB_SECURITY_NAMESPACE
    keys = [prefix + ":" + name for name, _ in budgets]
    try:
        retry = _redis(settings.REDIS_URL).eval(_ADMIT, len(keys), *keys, *[limit for _, limit in budgets])
    except (RedisError, ValueError):
        raise _access_error("认证服务暂时不可用", 503, "AUTH_UNAVAILABLE") from None
    if retry:
        raise _access_error("请求过于频繁，请稍后重试", 429, "RATE_LIMITED", int(retry))


def limit_auth(request, trusted=False):
    pool = "trusted" if trusted else "anonymous"
    ip = hashlib.sha256(client_ip(request).encode()).hexdigest()
    global_limit = settings.LAB_TRUSTED_AUTH_GLOBAL_LIMIT if trusted else settings.LAB_AUTH_GLOBAL_LIMIT
    ip_limit = settings.LAB_TRUSTED_AUTH_IP_LIMIT if trusted else settings.LAB_AUTH_IP_LIMIT
    admit([(f"auth:{pool}:global", global_limit), (f"auth:{pool}:ip:{ip}", ip_limit)])


def limit_user(request, category=None, user=None):
    user = user if user is not None else request.user
    if not getattr(user, "is_authenticated", False):
        return
    ordinary = category is None
    if ordinary and getattr(request, "_lab_user_budget_counted", False):
        return
    if category is None:
        category = "read" if request.method in ("GET", "HEAD", "OPTIONS") else "write"
    limit = {
        "read": settings.LAB_USER_READ_LIMIT,
        "write": settings.LAB_USER_WRITE_LIMIT,
        "api-key": settings.LAB_API_USER_LIMIT,
        "upload": settings.LAB_UPLOAD_USER_LIMIT,
    }[category]
    budgets = [(f"user:{user.id}:{category}", limit)]
    if ordinary and request.path.startswith("/api/v1/"):
        budgets.append((f"user:{user.id}:api-key", settings.LAB_API_USER_LIMIT))
    admit(budgets)
    if ordinary:
        request._lab_user_budget_counted = True


class AdmissionError(APIException):
    def __init__(self, error):
        self.status_code = error.status
        self.detail = {"error": error.message, "code": error.code, "retry_after": error.retry_after}
        self.wait = error.retry_after


def enforce_user_limits(request, user=None, category=None):
    from .auth import AccessError

    try:
        limit_user(request, category=category, user=user)
    except AccessError as error:
        raise AdmissionError(error) from None


class UserSecurityThrottle(BaseThrottle):
    def allow_request(self, request, view):
        enforce_user_limits(request)
        return True


class SecurityLimitsMiddleware:
    """Source bounds run before session cookie lookup, including invalid API keys."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        from .auth import AccessError

        path = request.path
        if settings.LAB_SECURITY_LIMITS_ENABLED and (path.startswith("/api/") or path.startswith("/auth/")):
            try:
                if path.startswith("/auth/lab/") and int(request.META.get("CONTENT_LENGTH") or 0) > 8192:
                    return JsonResponse({"code": "REQUEST_TOO_LARGE", "error": "请求过大"}, status=413)
                ip = hashlib.sha256(client_ip(request).encode()).hexdigest()
                from .auth import signed_browser

                trusted = bool(signed_browser(request) or signed_browser(request, admin=True))
                pool = "trusted" if trusted else "anonymous"
                global_limit = (
                    settings.LAB_TRUSTED_REQUEST_GLOBAL_LIMIT if trusted else settings.LAB_REQUEST_GLOBAL_LIMIT
                )
                ip_limit = settings.LAB_TRUSTED_REQUEST_IP_LIMIT if trusted else settings.LAB_REQUEST_IP_LIMIT
                admit([(f"request:{pool}:global", global_limit), (f"request:{pool}:ip:{ip}", ip_limit)])
            except AccessError as error:
                security_event(request, "request.rejected", reason=error.code)
                response = JsonResponse(
                    {"error": error.message, "code": error.code, "retry_after": error.retry_after}, status=error.status
                )
                if error.retry_after:
                    response["Retry-After"] = str(error.retry_after)
                return response
            except ValueError:
                return JsonResponse({"code": "INVALID_REQUEST", "error": "请求格式无效"}, status=400)
        return self.get_response(request)


class TrustedProxyMiddleware:
    """Django must never trust a scheme/host header supplied by another peer."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            peer = ipaddress.ip_address(request.META.get("REMOTE_ADDR", ""))
            trusted = any(peer in ipaddress.ip_network(value) for value in settings.TRUSTED_PROXY_CIDRS)
        except ValueError:
            trusted = False
        if not trusted:
            for header in ("HTTP_X_FORWARDED_FOR", "HTTP_X_FORWARDED_PROTO", "HTTP_X_FORWARDED_HOST", "HTTP_FORWARDED"):
                request.META.pop(header, None)
        if settings.PUBLIC_DEPLOYMENT:
            request.get_host()  # Validate Host even on views returning early.
        return self.get_response(request)
