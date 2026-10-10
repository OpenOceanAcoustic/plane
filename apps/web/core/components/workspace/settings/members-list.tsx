/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
import { useParams } from "next/navigation";
import useSWR from "swr";
// plane imports
import { useTranslation } from "@plane/i18n";
// components
import { MembersSettingsLoader } from "@/components/ui/loader/settings/members";
// hooks
import { useMember } from "@/hooks/store/use-member";
// local imports
import { WorkspaceMembersListItem } from "./members-list-item";

export const WorkspaceMembersList = observer(function WorkspaceMembersList(props: { searchQuery: string }) {
  const { searchQuery } = props;

  // router
  const { workspaceSlug } = useParams();
  // store hooks
  const {
    workspace: {
      fetchWorkspaceMembers,
      workspaceMemberIds,
      getFilteredWorkspaceMemberIds,
      getSearchedWorkspaceMemberIds,
      getWorkspaceMemberDetails,
    },
  } = useMember();
  const { t } = useTranslation();
  // fetching workspace members
  useSWR(
    workspaceSlug ? `WORKSPACE_MEMBERS_${workspaceSlug.toString()}` : null,
    workspaceSlug ? () => fetchWorkspaceMembers(workspaceSlug.toString()) : null
  );

  if (!workspaceMemberIds) return <MembersSettingsLoader />;

  // derived values
  const filteredMemberIds = workspaceSlug ? getFilteredWorkspaceMemberIds(workspaceSlug.toString()) : [];
  const searchedMemberIds = searchQuery ? getSearchedWorkspaceMemberIds(searchQuery) : filteredMemberIds;
  const memberDetails = searchedMemberIds
    ?.map((memberId) => getWorkspaceMemberDetails(memberId))
    // oxlint-disable-next-line unicorn/no-array-sort -- map creates a new array; sort supports the ES2022 target
    .sort((a, b) => {
      if (a?.is_active && !b?.is_active) return -1;
      if (!a?.is_active && b?.is_active) return 1;
      return 0;
    });

  return (
    <>
      <div className="divide-y-[0.5px] divide-subtle overflow-scroll">
        {searchedMemberIds?.length !== 0 && <WorkspaceMembersListItem memberDetails={memberDetails ?? []} />}
        {searchedMemberIds?.length === 0 && (
          <h4 className="mt-16 text-center text-body-xs-regular text-placeholder">{t("no_matching_members")}</h4>
        )}
      </div>
    </>
  );
});
