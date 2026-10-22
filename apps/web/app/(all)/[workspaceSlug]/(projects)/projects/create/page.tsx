/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useMemo } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { CreateProjectForm } from "@/components/projects/create/root";

export default function ProjectCreatePage() {
  const { workspaceSlug = "" } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const data = useMemo(
    () => ({
      name: params.get("name") ?? "",
      description: params.get("description") ?? "",
    }),
    [params]
  );
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col px-4 py-8">
      <CreateProjectForm
        workspaceSlug={workspaceSlug}
        data={data}
        onClose={() => navigate(`/${workspaceSlug}/projects`)}
        handleNextStep={(projectId) => navigate(`/${workspaceSlug}/projects/${projectId}`)}
        updateCoverImageStatus={() => Promise.resolve()}
      />
    </main>
  );
}
