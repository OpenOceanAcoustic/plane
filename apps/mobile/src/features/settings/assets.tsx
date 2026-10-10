import { useEffect, useState } from "react";
import { ActionButton, ErrorMessage } from "../../components/ui";
import { resolveImage } from "../../components/rich-editor";
import type { ApiClient } from "../../lib/client";
import { uploadSettingsImage } from "./api";

export function SettingsImage({
  client,
  title,
  source,
  path,
  entityType,
  identifier,
  refresh,
  editable = true,
}: {
  client: ApiClient;
  title: string;
  source?: unknown;
  path: string;
  entityType: string;
  identifier?: string;
  refresh: () => Promise<unknown>;
  editable?: boolean;
}) {
  const [image, setImage] = useState("");
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let active = true;
    let resolved = "";
    setImage("");
    if (typeof source === "string" && source)
      void resolveImage(client, source)
        .then((url) => {
          resolved = url;
          if (active) setImage(url);
          else if (url.startsWith("blob:")) URL.revokeObjectURL(url);
          return undefined;
        })
        .catch(setError);
    return () => {
      active = false;
      if (resolved.startsWith("blob:")) URL.revokeObjectURL(resolved);
    };
  }, [client, source]);
  const id = typeof source === "string" ? source.match(/\/api\/assets\/v2\/static\/([0-9a-f-]+)\//i)?.[1] : undefined;
  return (
    <div className="field">
      <span>{title}</span>
      {image && (
        <img
          src={image}
          alt={title}
          style={{ maxWidth: "100%", maxHeight: 160, objectFit: "cover", borderRadius: 12 }}
        />
      )}
      {editable && (
        <div className="actions">
          <ActionButton
            action={async () => {
              await uploadSettingsImage(client, path, entityType, identifier);
              await refresh();
            }}
          >
            选择图片
          </ActionButton>
          {id && (
            <ActionButton
              className="button danger"
              action={async () => {
                await client.request(`${path}${id}/`, "DELETE");
                await refresh();
              }}
            >
              移除图片
            </ActionButton>
          )}
        </div>
      )}
      <ErrorMessage error={error} />
    </div>
  );
}
