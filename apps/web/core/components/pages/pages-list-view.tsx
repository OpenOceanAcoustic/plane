/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import useSWR from "swr";
import type { TPageNavigationTabs } from "@plane/types";
// hooks
import type { EPageStoreType } from "@/hooks/store";
import { usePageStore } from "@/hooks/store";
import { useUserPermissions } from "@/hooks/store/user";
import { EUserPermissionsLevel } from "@plane/constants";
import { EUserProjectRoles } from "@plane/types";
import { LabExperimentTemplateButton } from "@/components/lab/documents";
import { LabDocumentUploadButton } from "@/components/lab/document-file-upload";
// local imports
import { PagesListHeaderRoot } from "./header";
import { PagesListMainContent } from "./pages-list-main-content";

type TPageView = {
  children: React.ReactNode;
  pageType: TPageNavigationTabs;
  projectId: string;
  storeType: EPageStoreType;
  workspaceSlug: string;
};

export const PagesListView = observer(function PagesListView(props: TPageView) {
  const { children, pageType, projectId, storeType, workspaceSlug } = props;
  // store hooks
  const { isAnyPageAvailable, fetchPagesList } = usePageStore(storeType);
  const { allowPermissions } = useUserPermissions();
  const canCreate = allowPermissions(
    [EUserProjectRoles.ADMIN, EUserProjectRoles.MEMBER],
    EUserPermissionsLevel.PROJECT
  );
  // fetching pages list
  useSWR(
    workspaceSlug && projectId && pageType ? `PROJECT_PAGES_${projectId}` : null,
    workspaceSlug && projectId && pageType ? () => fetchPagesList(workspaceSlug, projectId, pageType) : null
  );

  // pages loader
  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden">
      {canCreate && pageType !== "archived" && (
        <div className="flex shrink-0 flex-wrap justify-end gap-2 border-b border-subtle px-4 py-2">
          <LabExperimentTemplateButton
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            defaultAccess={pageType === "private" ? 1 : 0}
          />
          <LabDocumentUploadButton
            workspaceSlug={workspaceSlug}
            projectId={projectId}
            defaultAccess={pageType === "private" ? 1 : 0}
            onUploaded={() => fetchPagesList(workspaceSlug, projectId, pageType)}
          />
        </div>
      )}
      {/* tab header */}
      {isAnyPageAvailable && (
        <PagesListHeaderRoot
          pageType={pageType}
          projectId={projectId}
          storeType={storeType}
          workspaceSlug={workspaceSlug}
        />
      )}
      <PagesListMainContent pageType={pageType} storeType={storeType}>
        {children}
      </PagesListMainContent>
    </div>
  );
});
