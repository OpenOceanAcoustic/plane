/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useMemo, useRef, useState } from "react";
import { observer } from "mobx-react";
import { useDropzone } from "react-dropzone";
import useSWR from "swr";
import { API_BASE_URL, MAX_FILE_SIZE } from "@plane/constants";
import { InstanceService } from "@plane/services";
import { LabStore } from "@plane/shared-state";
import { Button, LabDialog, LabField, labInputClass } from "@plane/ui";
import type { LabDocument } from "./document-types";

const extensions = new Set([".txt", ".md", ".doc", ".docx", ".xls", ".xlsx"]);
const acceptedFiles = {
  "text/plain": [".txt"],
  "text/markdown": [".md"],
  "application/msword": [".doc"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.ms-excel": [".xls"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
};
type UploadProps = {
  workspaceSlug: string;
  projectId: string;
  issueId?: string;
  defaultAccess?: 0 | 1;
  onUploaded?: (document: LabDocument) => Promise<unknown>;
};

function fileError(file: File, limit: number): string {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!extensions.has(extension)) return "请选择 TXT、MD、DOC、DOCX、XLS 或 XLSX 文件";
  if (!file.size) return "文件为空";
  if (file.size > limit) return `文件超过 ${(limit / 1024 / 1024).toFixed(1)} MB`;
  return "";
}

const UploadDialog = observer(function UploadDialog({
  workspaceSlug,
  projectId,
  issueId,
  defaultAccess = 0,
  onUploaded,
  onClose,
}: UploadProps & { onClose: () => void }) {
  const transport = useMemo(() => new LabStore(API_BASE_URL, workspaceSlug), [workspaceSlug]);
  const instanceService = useMemo(() => new InstanceService(), []);
  const { data: instance } = useSWR("lab-document-upload-instance", () => instanceService.info());
  const configuredLimit = instance?.config?.file_size_limit;
  const limit = typeof configuredLimit === "number" && configuredLimit > 0 ? configuredLimit : MAX_FILE_SIZE;
  const [file, setFile] = useState<File>();
  const [name, setName] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: acceptedFiles,
    maxSize: limit,
    multiple: false,
    disabled: transport.busy,
    noClick: true,
    noKeyboard: true,
    validator: (candidate) => {
      const message = fileError(candidate, limit);
      return message ? { code: "document-file-invalid", message } : null;
    },
    onDropAccepted: ([chosen]) => {
      if (!chosen) return;
      setFile(chosen);
      setName((current) => (!current || current === file?.name ? chosen.name : current));
      setSelectionError("");
    },
    onDropRejected: (rejections) => {
      setFile(undefined);
      const rejection = rejections[0];
      setSelectionError(rejection ? fileError(rejection.file, limit) || "一次选择一个文件" : "请选择有效文件");
    },
  });
  const validationError = selectionError || (file ? fileError(file, limit) : "");
  return (
    <LabDialog
      title="上传文档"
      busy={transport.busy}
      onClose={onClose}
      error={validationError || transport.error}
      submitDisabled={!file || !!validationError}
      onSubmit={(form) =>
        transport.execute(async () => {
          if (!file) throw new Error("请选择文件");
          const invalid = fileError(file, limit);
          if (invalid) throw new Error(invalid);
          const data = new FormData();
          data.append("file", file);
          data.append("name", name.trim());
          data.append("access", form.get("private") === "on" ? "1" : "0");
          if (issueId) data.append("issue_id", issueId);
          const document = await transport.upload<LabDocument>(`projects/${projectId}/documents/upload/`, data);
          if (!mounted.current) return;
          onClose();
          await onUploaded?.(document);
        })
      }
    >
      <div
        {...getRootProps()}
        aria-label="文件拖放区域"
        className={`rounded-md border-2 border-dashed p-3 ${isDragActive ? "border-accent-strong bg-accent-primary/5" : "border-subtle"}`}
      >
        <LabField label="文件">
          <input
            {...getInputProps({ style: {}, tabIndex: 0, "aria-label": "文件", disabled: transport.busy })}
            className={labInputClass}
          />
        </LabField>
        {file && (
          <p className="mt-2 text-12 break-all text-secondary">
            {file.name} · {file.size} B
          </p>
        )}
      </div>
      <LabField label="文档名称">
        <input
          name="name"
          required
          maxLength={255}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={labInputClass}
          disabled={transport.busy}
        />
      </LabField>
      <label className="flex items-center gap-2 text-13">
        <input type="checkbox" name="private" defaultChecked={defaultAccess === 1} disabled={transport.busy} />
        私人
      </label>
    </LabDialog>
  );
});

export function LabDocumentUploadButton(props: UploadProps) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [props.workspaceSlug, props.projectId, props.issueId]);
  return (
    <>
      <Button size="sm" variant="neutral-primary" onClick={() => setOpen(true)}>
        上传文档
      </Button>
      {open && (
        <UploadDialog
          key={`${props.workspaceSlug}:${props.projectId}:${props.issueId ?? ""}`}
          {...props}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
