/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { ReactNode } from "react";
import { useEffect } from "react";
import { observer } from "mobx-react";
import { Controller, useForm } from "react-hook-form";
import useSWR from "swr";
// plane imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IProject, IUserLite, IWorkspace } from "@plane/types";
import { Loader, ToggleSwitch } from "@plane/ui";
// constants
import { PROJECT_DETAILS } from "@plane/constants";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import { MemberSelect } from "./member-select";

const defaultValues: Partial<IProject> = {
  project_lead: null,
  default_assignee: null,
};

type TDefaultSettingItemProps = {
  title: string;
  description: string;
  children: ReactNode;
};

function DefaultSettingItem({ title, description, children }: TDefaultSettingItemProps) {
  return (
    <div className="flex items-center justify-between gap-x-2">
      <div className="flex flex-col gap-0.5">
        <h4 className="text-13 font-medium">{title}</h4>
        <p className="text-11 text-tertiary">{description}</p>
      </div>
      <div className="w-full max-w-48 sm:max-w-64">{children}</div>
    </div>
  );
}

type TProjectSettingsMemberDefaultsProps = {
  workspaceSlug: string;
  projectId: string;
};

export const ProjectSettingsMemberDefaults = observer(function ProjectSettingsMemberDefaults(
  props: TProjectSettingsMemberDefaultsProps
) {
  const { workspaceSlug, projectId } = props;
  // plane hooks
  const { t } = useTranslation();
  // store hooks
  const { allowPermissions } = useUserPermissions();

  const { currentProjectDetails, fetchProjectDetails, updateProject } = useProject();
  // derived values
  const isAdmin = allowPermissions(
    [EUserPermissions.ADMIN],
    EUserPermissionsLevel.PROJECT,
    workspaceSlug,
    currentProjectDetails?.id
  );
  // form info
  const { reset, control } = useForm<IProject>({ defaultValues });
  // fetching user members
  useSWR(
    workspaceSlug && projectId ? PROJECT_DETAILS(workspaceSlug, projectId) : null,
    workspaceSlug && projectId ? () => fetchProjectDetails(workspaceSlug, projectId) : null
  );

  useEffect(() => {
    if (!currentProjectDetails) return;

    reset({
      ...currentProjectDetails,
      default_assignee:
        (currentProjectDetails.default_assignee as IUserLite)?.id ?? currentProjectDetails.default_assignee,
      project_lead: (currentProjectDetails.project_lead as IUserLite)?.id ?? currentProjectDetails.project_lead,
      workspace: (currentProjectDetails.workspace as IWorkspace).id,
    });
  }, [currentProjectDetails, reset]);

  const submitChanges = async (formData: Partial<IProject>) => {
    if (!workspaceSlug || !projectId) return;

    reset({
      ...currentProjectDetails,
      default_assignee:
        (currentProjectDetails?.default_assignee as IUserLite)?.id ?? currentProjectDetails?.default_assignee,
      project_lead: (currentProjectDetails?.project_lead as IUserLite)?.id ?? currentProjectDetails?.project_lead,
      ...formData,
    });

    await updateProject(workspaceSlug, projectId, {
      default_assignee:
        formData.default_assignee === "none"
          ? null
          : (formData.default_assignee ?? currentProjectDetails?.default_assignee),
      project_lead:
        formData.project_lead === "none" ? null : (formData.project_lead ?? currentProjectDetails?.project_lead),
    })
      .then(() => {
        setToast({
          title: `${t("success")}!`,
          type: TOAST_TYPE.SUCCESS,
          message: t("project_settings.general.toast.success"),
        });
      })
      .catch((err) => {
        console.error(err);
      });
  };

  const toggleGuestViewAllIssues = async (value: boolean) => {
    if (!workspaceSlug || !projectId) return;

    updateProject(workspaceSlug, projectId, {
      guest_view_all_features: value,
    })
      .then(() => {
        setToast({
          title: `${t("success")}!`,
          type: TOAST_TYPE.SUCCESS,
          message: t("project_settings.general.toast.success"),
        });
      })
      .catch((err) => {
        console.error(err);
      });
  };

  const lead = currentProjectDetails?.project_lead as IUserLite | null | undefined;
  const leadName = lead?.display_name?.trim() || "未设置";
  return (
    <div className="my-6 flex flex-col gap-y-6">
      <section
        aria-label="项目负责人"
        className="border-emerald-500/30 bg-emerald-500/5 flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0">
          <p className="text-emerald-600 flex items-center gap-2 text-11 font-semibold tracking-wide uppercase">
            项目负责人
            <span className="bg-emerald-500/15 rounded px-1.5 py-0.5 text-10 font-medium normal-case">
              Project Lead
            </span>
          </p>
          <h2 className="mt-1 truncate text-18 font-semibold">{leadName}</h2>
          <p className="mt-1 text-12 text-secondary">
            负责人审批成员加入、现金悬赏和项目财务；只有项目管理员可以变更。
          </p>
        </div>
        <div className="w-full sm:max-w-64">
          {currentProjectDetails ? (
            <Controller
              control={control}
              name="project_lead"
              render={({ field: { value } }) => (
                <MemberSelect
                  value={value}
                  onChange={(val: string) => {
                    submitChanges({ project_lead: val });
                  }}
                  isDisabled={!isAdmin}
                />
              )}
            />
          ) : (
            <Loader className="h-9 w-full">
              <Loader.Item width="100%" height="100%" />
            </Loader>
          )}
          {!isAdmin && <p className="mt-2 text-11 text-tertiary">你没有项目管理员权限，无法变更负责人。</p>}
        </div>
      </section>
      <DefaultSettingItem title="Default Assignee" description="Select the default assignee for the project.">
        {currentProjectDetails ? (
          <Controller
            control={control}
            name="default_assignee"
            render={({ field: { value } }) => (
              <MemberSelect
                value={value}
                onChange={(val: string) => {
                  submitChanges({ default_assignee: val });
                }}
                isDisabled={!isAdmin}
              />
            )}
          />
        ) : (
          <Loader className="h-9 w-full">
            <Loader.Item width="100%" height="100%" />
          </Loader>
        )}
      </DefaultSettingItem>
      {currentProjectDetails && (
        <DefaultSettingItem
          title="Guest access"
          description="This will allow guests to have view access to all the project work items."
        >
          <div className="flex items-center justify-end">
            <ToggleSwitch
              value={!!currentProjectDetails?.guest_view_all_features}
              onChange={() => toggleGuestViewAllIssues(!currentProjectDetails?.guest_view_all_features)}
              disabled={!isAdmin}
              size="sm"
            />
          </div>
        </DefaultSettingItem>
      )}
    </div>
  );
});
