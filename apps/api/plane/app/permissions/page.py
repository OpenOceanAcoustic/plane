# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from plane.db.models import ProjectMember, Page, WorkspaceMember
from plane.app.permissions import ROLE


from rest_framework.permissions import BasePermission, SAFE_METHODS


# Permission Mappings for workspace members
ADMIN = ROLE.ADMIN.value
MEMBER = ROLE.MEMBER.value
GUEST = ROLE.GUEST.value


def active_page_membership(user, slug, project_id):
    if (
        not user.is_authenticated
        or not user.is_active
        or not WorkspaceMember.objects.filter(
            member=user, workspace__slug=slug, workspace__deleted_at__isnull=True, is_active=True
        ).exists()
    ):
        return None
    membership = (
        ProjectMember.objects.select_related("project")
        .filter(
            member=user,
            workspace__slug=slug,
            is_active=True,
            project_id=project_id,
            project__deleted_at__isnull=True,
            project__archived_at__isnull=True,
        )
        .first()
    )
    if not membership or (membership.role == GUEST and not membership.project.guest_view_all_features):
        return None
    return membership


def scoped_page(slug, project_id, page_id):
    return (
        Page.objects.filter(
            id=page_id,
            workspace__slug=slug,
            project_pages__project_id=project_id,
            project_pages__deleted_at__isnull=True,
        )
        .select_related("workspace")
        .first()
    )


def page_role_allows(role, method):
    if method in SAFE_METHODS:
        return role in (ADMIN, MEMBER, GUEST)
    if method in ("POST", "PUT", "PATCH"):
        return role in (ADMIN, MEMBER)
    return method == "DELETE" and role == ADMIN


def page_collaboration_capabilities(user, slug, project_id, page_id):
    membership = active_page_membership(user, slug, project_id)
    page = scoped_page(slug, project_id, page_id) if membership else None
    if page is None:
        return None, False, False
    owner = page.owned_by_id == user.id
    readable = owner or (page.access == Page.PUBLIC_ACCESS and page_role_allows(membership.role, "GET"))
    writable = (
        readable
        and (owner or page_role_allows(membership.role, "PATCH"))
        and not page.is_locked
        and not page.archived_at
    )
    return page, readable, writable


class ProjectPagePermission(BasePermission):
    """
    Custom permission to control access to pages within a workspace
    based on user roles, page visibility (public/private), and feature flags.
    """

    def has_permission(self, request, view):
        """
        Check basic project-level permissions before checking object-level permissions.
        """
        if request.user.is_anonymous:
            return False

        user_id = request.user.id
        slug = view.kwargs.get("slug")
        page_id = view.kwargs.get("page_id")
        project_id = view.kwargs.get("project_id")

        # Hook for extended validation
        extended_access, role = self._check_access_and_get_role(request, slug, project_id)
        if extended_access is False:
            return False

        if page_id:
            # Scope the page to the project in the URL. Resolving the page by
            # workspace + page_id alone allowed a member of one project to read
            # pages belonging to another project in the same workspace
            # (GHSA-g49r / GHSA-ghcr). Require an *active* ProjectPage link (both
            # conditions on the same relation so they match one row) so a page
            # removed from the project (soft-deleted link) is also denied.
            page = scoped_page(slug, project_id, page_id)
            if page is None:
                return False

            # Allow access if the user is the owner of the page
            if page.owned_by_id == user_id:
                return True

            # Handle private page access
            if page.access == Page.PRIVATE_ACCESS:
                return self._has_private_page_action_access(request, slug, page, project_id)

        # Handle public page access
        return self._has_public_page_action_access(request, role)

    def _check_project_member_access(self, request, slug, project_id):
        """
        Check if the user is a project member.
        """
        membership = active_page_membership(request.user, slug, project_id)
        return membership.role if membership else None

    def _check_access_and_get_role(self, request, slug, project_id):
        """
        Hook for extended access checking
        Returns: True (allow), False (deny), None (continue with normal flow)
        """
        role = self._check_project_member_access(request, slug, project_id)
        if not role:
            return False, None
        return True, role

    def _has_private_page_action_access(self, request, slug, page, project_id):
        """
        Check access to private pages. Override for feature flag logic.
        """
        # Base implementation: only owner can access private pages
        return False

    def _check_project_action_access(self, request, role):
        return page_role_allows(role, request.method)

    def _has_public_page_action_access(self, request, role):
        """
        Check if the user has permission to access a public page
        and can perform operations on the page.
        """
        project_member_exists = self._check_project_action_access(request, role)
        if not project_member_exists:
            return False
        return True
