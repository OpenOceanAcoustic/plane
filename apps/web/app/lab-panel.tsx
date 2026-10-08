/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { useCallback, useEffect, useRef } from "react";
import { observer } from "mobx-react";
import { useParams } from "react-router";
import useSWR, { useSWRConfig } from "swr";
import {
  EUserPermissions,
  EUserPermissionsLevel,
  PROJECT_ALL_CYCLES,
  PROJECT_DETAILS,
  PROJECT_ESTIMATES,
  PROJECT_LABELS,
  PROJECT_MEMBERS,
  PROJECT_MEMBER_PREFERENCES,
  PROJECT_ME_INFORMATION,
  PROJECT_MODULES,
  PROJECT_STATES,
} from "@plane/constants";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { EIssuesStoreType } from "@plane/types";
import { LabPanel } from "@/components/lab/panel";
import type { LabOpenProjectIssue, LabProjectIssueRef } from "@/components/lab/item-details";
import { IssuePeekOverview } from "@/components/issues/peek-overview";
import { useIssueDetail } from "@/hooks/store/use-issue-detail";
import { useProjectEstimates } from "@/hooks/store/estimates";
import { useCycle } from "@/hooks/store/use-cycle";
import { useLabel } from "@/hooks/store/use-label";
import { useMember } from "@/hooks/store/use-member";
import { useModule } from "@/hooks/store/use-module";
import { useProject } from "@/hooks/store/use-project";
import { useProjectState } from "@/hooks/store/use-project-state";
import { useUser, useUserPermissions } from "@/hooks/store/user";

const LabPanelRoute = observer(function LabPanelRoute() {
  const { workspaceSlug = "" } = useParams();
  const { peekIssue, setPeekIssue } = useIssueDetail();
  const { mutate } = useSWRConfig();
  const { fetchProjectDetails } = useProject();
  const { fetchProjectLabels } = useLabel();
  const { fetchProjectStates } = useProjectState();
  const { project: projectMembers } = useMember();
  const { getProjectEstimates } = useProjectEstimates();
  const cycles = useCycle();
  const modules = useModule();
  const { data: currentUser } = useUser();
  const { fetchUserProjectInfo, getProjectRoleByWorkspaceSlugAndProjectId, allowPermissions } = useUserPermissions();
  const ownedIssue = useRef<LabProjectIssueRef | undefined>(undefined);
  const currentPeek = useRef(peekIssue);
  currentPeek.current = peekIssue;
  const projectId = peekIssue?.workspaceSlug === workspaceSlug ? peekIssue.projectId : undefined;
  useSWR(
    projectId ? ["lab-project-peek-properties", workspaceSlug, projectId] : null,
    async () => {
      if (!projectId) return;
      // Fill the same native stores and SWR cache entries as the project layout.
      // The task itself opens immediately and keeps its own permission/error UI.
      const read = <T,>(key: string, fetch: () => Promise<T>) => mutate<T>(key, fetch(), { revalidate: false });
      const role = getProjectRoleByWorkspaceSlugAndProjectId(workspaceSlug, projectId);
      const base = await Promise.allSettled([
        read(PROJECT_DETAILS(workspaceSlug, projectId), () => fetchProjectDetails(workspaceSlug, projectId)),
        read(PROJECT_ME_INFORMATION(workspaceSlug, projectId), () => fetchUserProjectInfo(workspaceSlug, projectId)),
        read(PROJECT_STATES(projectId, role), () => fetchProjectStates(workspaceSlug, projectId)),
        read(PROJECT_LABELS(projectId, role), () => fetchProjectLabels(workspaceSlug, projectId)),
        read(PROJECT_MEMBERS(projectId, role), () => projectMembers.fetchProjectMembers(workspaceSlug, projectId)),
      ] as const);
      const project = base[0].status === "fulfilled" ? base[0].value : undefined;
      const currentRole = getProjectRoleByWorkspaceSlugAndProjectId(workspaceSlug, projectId);
      const editable = allowPermissions(
        [EUserPermissions.ADMIN, EUserPermissions.MEMBER],
        EUserPermissionsLevel.PROJECT,
        workspaceSlug,
        projectId
      );
      const fullFeatures = editable || (currentRole === EUserPermissions.GUEST && project?.guest_view_all_features);
      const optional: Promise<unknown>[] = [];
      if (currentUser && editable)
        optional.push(
          read(PROJECT_MEMBER_PREFERENCES(projectId, currentRole), () =>
            projectMembers.fetchProjectUserProperties(workspaceSlug, projectId)
          )
        );
      if (project?.cycle_view && fullFeatures)
        optional.push(
          read(PROJECT_ALL_CYCLES(projectId, currentRole), async () => {
            await cycles.fetchAllCycles(workspaceSlug, projectId);
            if (!cycles.fetchedMap[projectId]) throw new Error("周期读取失败");
            return true;
          })
        );
      if (project?.module_view && fullFeatures)
        optional.push(
          read(PROJECT_MODULES(projectId, currentRole), async () => {
            const results = await Promise.allSettled([
              modules.fetchModulesSlim(workspaceSlug, projectId),
              modules.fetchModules(workspaceSlug, projectId),
            ]);
            if (results.some((result) => result.status === "rejected") || !modules.fetchedMap[projectId])
              throw new Error("模块读取失败");
            return true;
          })
        );
      if (project?.estimate && fullFeatures)
        optional.push(
          read(PROJECT_ESTIMATES(projectId, currentRole), () => getProjectEstimates(workspaceSlug, projectId))
        );
      const extra = await Promise.allSettled(optional);
      if ([...base, ...extra].some((result) => result.status === "rejected"))
        throw new Error("部分项目属性未能加载，请刷新后重试。");
      return true;
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      shouldRetryOnError: false,
      onError: () => {
        if (currentPeek.current?.projectId === projectId)
          setToast({
            type: TOAST_TYPE.ERROR,
            title: "项目信息读取失败",
            message: "部分项目属性未能加载，请刷新后重试。",
          });
      },
    }
  );
  const openProjectIssue = useCallback<LabOpenProjectIssue>(
    (issue) => {
      if (!workspaceSlug) return;
      ownedIssue.current = issue;
      setPeekIssue({
        workspaceSlug,
        projectId: issue.project_id,
        issueId: issue.issue_id,
        isArchived: Boolean(issue.archived),
      });
    },
    [setPeekIssue, workspaceSlug]
  );
  useEffect(
    () => () => {
      const owned = ownedIssue.current;
      const current = currentPeek.current;
      if (
        owned &&
        current?.workspaceSlug === workspaceSlug &&
        current.projectId === owned.project_id &&
        current.issueId === owned.issue_id
      )
        setPeekIssue(undefined);
    },
    [setPeekIssue, workspaceSlug]
  );
  return (
    <>
      <LabPanel openProjectIssue={openProjectIssue} projectDetailsOpen={Boolean(peekIssue)} />
      <IssuePeekOverview storeType={EIssuesStoreType.PROJECT} />
    </>
  );
});

export default LabPanelRoute;
