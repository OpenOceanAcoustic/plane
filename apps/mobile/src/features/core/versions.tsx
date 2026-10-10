import { useState } from "react";
import { ActionButton, Html, Sheet, useData, records, type Entity } from "../../components/ui";
import { Empty, ResultState } from "./shared";
import { CoreService, dateLabel } from "./model";
export function DescriptionVersions({
  service,
  issueId,
  canEdit,
  onClose,
  onRestore,
}: {
  service: CoreService;
  issueId: string;
  canEdit: boolean;
  onClose: () => void;
  onRestore: () => Promise<unknown>;
}) {
  const base = `${service.projectPath}/work-items/${issueId}/description-versions/`;
  const [cursors, setCursors] = useState([""]),
    [selected, setSelected] = useState<string>();
  const cursor = cursors[cursors.length - 1];
  const versions = useData<Entity>(
    service.client,
    `${base}?per_page=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`
  );
  const detail = useData<Entity>(service.client, selected ? `${base}${selected}/` : null);
  const [confirm, setConfirm] = useState(false);
  return (
    <Sheet title="描述版本" onClose={onClose}>
      <ResultState loading={versions.loading} error={versions.error}>
        <div className="list">
          {records(versions.data).map((row) => (
            <button
              className="card core-select-task"
              key={row.id}
              onClick={() => {
                setSelected(String(row.id));
                setConfirm(false);
              }}
            >
              <strong>{dateLabel(row.last_saved_at ?? row.created_at)}</strong>
              <span className="muted">{new Date(String(row.created_at)).toLocaleString("zh-CN")}</span>
            </button>
          ))}
          {!records(versions.data).length && <Empty>暂无保存版本</Empty>}
        </div>
      </ResultState>
      <div className="core-pager">
        <button className="button" disabled={cursors.length < 2} onClick={() => setCursors(cursors.slice(0, -1))}>
          上一页
        </button>
        <button
          className="button"
          disabled={!versions.data?.next_page_results}
          onClick={() => setCursors([...cursors, String(versions.data?.next_cursor)])}
        >
          下一页
        </button>
      </div>
      {selected && (
        <ResultState loading={detail.loading} error={detail.error}>
          <div className="card">
            <Html html={detail.data?.description_html} />
          </div>
          {canEdit &&
            detail.data &&
            (confirm ? (
              <>
                <p>将此版本恢复为当前描述，现有描述会保留在版本记录中。</p>
                <ActionButton
                  className="button primary"
                  action={async () => {
                    await service.saveDescription(issueId, String(detail.data?.description_html ?? "<p></p>"));
                    await onRestore();
                    onClose();
                  }}
                >
                  确认恢复
                </ActionButton>
              </>
            ) : (
              <button className="button" onClick={() => setConfirm(true)}>
                恢复此版本
              </button>
            ))}
        </ResultState>
      )}
    </Sheet>
  );
}
