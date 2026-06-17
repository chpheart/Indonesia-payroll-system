import { appendAuditCorrectionAction } from "@/app/(app)/audit/actions";

type AuditCorrection = {
  id: string;
  note: string;
  createdByEmail: string;
};

type AuditLogDetailProps = {
  log: {
    id: string;
    action: string;
    objectType: string;
    objectId: string;
    riskLevel: string;
    actorEmail: string;
    actorRoleCodes: string[];
    purpose: string | null;
    ipAddress: string | null;
    userAgent: string | null;
    metadata: unknown;
    corrections: AuditCorrection[];
  };
};

function metadataValue(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return "-";
  }

  const value = (metadata as Record<string, unknown>)[key];
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join(", ") : "-";
  }

  if (value === null || value === undefined || value === "") {
    return "-";
  }

  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function auditVersion(metadata: unknown) {
  const versionNumber = metadataValue(metadata, "versionNumber");
  const version = versionNumber !== "-" ? `v${versionNumber}` : metadataValue(metadata, "version");
  const effectiveMonth = metadataValue(metadata, "effectiveMonth");
  return effectiveMonth === "-" ? version : `${version} · ${effectiveMonth}`;
}

export function AuditLogDetail({ log }: AuditLogDetailProps) {
  return (
    <>
      {log.corrections.length > 0
        ? log.corrections.map((correction) => (
            <span className="stacked-text" key={correction.id}>
              {correction.createdByEmail}：{correction.note}
            </span>
          ))
        : "无"}
      <details className="audit-details">
        <summary>查看详情 / 追加更正</summary>
        <div className="detail-panel">
          <h3>审计事件详情</h3>
          <dl>
            <dt>动作</dt>
            <dd>{log.action}</dd>
            <dt>风险</dt>
            <dd>{log.riskLevel}</dd>
            <dt>对象</dt>
            <dd>
              {log.objectType} · {log.objectId}
            </dd>
            <dt>操作者</dt>
            <dd>{log.actorEmail}</dd>
            <dt>角色</dt>
            <dd>{log.actorRoleCodes.join(", ") || "-"}</dd>
            <dt>用途</dt>
            <dd>{log.purpose ?? "-"}</dd>
            <dt>IP / 设备</dt>
            <dd>
              {log.ipAddress ?? "-"} · {log.userAgent ?? "-"}
            </dd>
            <dt>输入摘要</dt>
            <dd>{metadataValue(log.metadata, "inputSummary")}</dd>
            <dt>输出摘要</dt>
            <dd>{metadataValue(log.metadata, "outputSummary")}</dd>
            <dt>版本</dt>
            <dd>{auditVersion(log.metadata)}</dd>
            <dt>证据</dt>
            <dd>{metadataValue(log.metadata, "evidenceRefs")}</dd>
            <dt>metadata</dt>
            <dd>{JSON.stringify(log.metadata)}</dd>
          </dl>
          <h4>追加更正说明</h4>
          <form action={appendAuditCorrectionAction} className="correction-form">
            <input type="hidden" name="auditLogId" value={log.id} />
            <input
              aria-label="更正说明"
              name="note"
              placeholder="追加更正说明，不修改原日志"
              required
            />
            <button type="submit">追加说明</button>
          </form>
        </div>
      </details>
    </>
  );
}
