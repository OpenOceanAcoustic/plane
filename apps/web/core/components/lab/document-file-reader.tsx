/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import useSWR from "swr";
import { API_BASE_URL } from "@plane/constants";
import { LabStore } from "@plane/shared-state";
import { Button, LabDialog } from "@plane/ui";
import type { LabDocument, LabDocumentFile, LabDocumentPreview } from "./document-types";
// oxlint-disable-next-line import/no-unassigned-import -- isolated document typography
import "./document-file.css";

function FileDownload({ transport, file }: { transport: LabStore; file: LabDocumentFile }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function download() {
    setBusy(true);
    setError("");
    try {
      const { blob } = await transport.download(file.download_path);
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "下载失败，请重试");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <Button
        size="sm"
        type="button"
        variant="neutral-primary"
        loading={busy}
        onClick={() => {
          void download();
        }}
      >
        下载
      </Button>
      {error && (
        <p role="alert" className="text-12 text-danger-primary">
          {error}
        </p>
      )}
    </>
  );
}

function FileReader({ transport, file, onClose }: { transport: LabStore; file: LabDocumentFile; onClose: () => void }) {
  const [preview, setPreview] = useState<LabDocumentPreview>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setPreview(undefined);
    setError("");
    setLoading(true);
    if (!file.previewable || !file.preview_path) {
      setError("此文件无法在线阅读");
      setLoading(false);
      return;
    }
    const path = file.preview_path;
    async function read() {
      try {
        const data = await transport.request<LabDocumentPreview>(path);
        if (active) setPreview(data);
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : "文档读取失败");
      } finally {
        if (active) setLoading(false);
      }
    }
    void read();
    return () => {
      active = false;
    };
  }, [transport, file.previewable, file.preview_path, attempt]);
  return (
    <LabDialog title="阅读文档" busy={false} onClose={onClose}>
      <p className="text-13 break-all text-secondary">{preview?.filename || file.name}</p>
      {loading && (
        <p role="status" className="text-13 text-secondary">
          正在加载…
        </p>
      )}
      {error && (
        <div className="space-y-2">
          <p role="alert" className="text-13 text-danger-primary">
            {error}
          </p>
          <Button size="sm" type="button" variant="neutral-primary" onClick={() => setAttempt((value) => value + 1)}>
            重试
          </Button>
        </div>
      )}
      {!loading && !error && preview && (
        <div className="lab-document-preview">
          {preview.format === "md" ? (
            <ReactMarkdown
              className="lab-document-markdown text-13 text-primary"
              skipHtml
              components={{
                a: ({ href, children }) =>
                  href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-primary underline">
                      {children}
                    </a>
                  ) : (
                    <span>{children}</span>
                  ),
                img: ({ alt }) => <span>{alt}</span>,
              }}
            >
              {preview.text}
            </ReactMarkdown>
          ) : (
            <pre className="text-13 whitespace-pre-wrap text-primary">{preview.text}</pre>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <FileDownload transport={transport} file={file} />
      </div>
    </LabDialog>
  );
}

export function LabDocumentFileActions({ workspaceSlug, file }: { workspaceSlug: string; file: LabDocumentFile }) {
  const transport = useMemo(() => new LabStore(API_BASE_URL, workspaceSlug), [workspaceSlug]);
  const [reading, setReading] = useState(false);
  useEffect(() => setReading(false), [transport, file.preview_path]);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {file.previewable && file.preview_path && (
        <Button size="sm" type="button" variant="neutral-primary" onClick={() => setReading(true)}>
          阅读
        </Button>
      )}
      <FileDownload key={`${workspaceSlug}:${file.download_path}`} transport={transport} file={file} />
      {reading && (
        <FileReader
          key={`${workspaceSlug}:${file.preview_path}`}
          transport={transport}
          file={file}
          onClose={() => setReading(false)}
        />
      )}
    </div>
  );
}

export function LabPageDocumentFilePanel({
  workspaceSlug,
  projectId,
  pageId,
}: {
  workspaceSlug: string;
  projectId: string;
  pageId: string;
}) {
  const transport = useMemo(() => new LabStore(API_BASE_URL, workspaceSlug), [workspaceSlug]);
  const { data, error, mutate } = useSWR(["lab-page-document-file", workspaceSlug, projectId, pageId], () =>
    transport.request<LabDocument>(`projects/${projectId}/documents/${pageId}/`)
  );
  if (!error && !data?.file) return null;
  return (
    <section
      aria-label="文档文件"
      className="mx-page-x mb-3 flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-subtle bg-layer-1 px-3 py-2"
    >
      {error ? (
        <>
          <p role="alert" className="text-12 text-danger-primary">
            {error instanceof Error ? error.message : "文件信息读取失败"}
          </p>
          <Button
            size="sm"
            type="button"
            variant="neutral-primary"
            onClick={() => {
              void mutate().catch(() => undefined);
            }}
          >
            重试
          </Button>
        </>
      ) : (
        data?.file && (
          <>
            <span className="mr-auto text-13 break-all">{data.file.name}</span>
            <LabDocumentFileActions workspaceSlug={workspaceSlug} file={data.file} />
          </>
        )
      )}
    </section>
  );
}
