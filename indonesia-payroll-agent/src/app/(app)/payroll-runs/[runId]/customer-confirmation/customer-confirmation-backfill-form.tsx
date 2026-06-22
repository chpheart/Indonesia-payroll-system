import { recordCustomerConfirmationAction } from "@/app/(app)/payroll-runs/[runId]/phase9-actions";

type EvidenceOption = {
  id: string;
  redactedSummary: string;
  sourceLabel: string;
};

type CustomerConfirmationBackfillFormProps = {
  evidences: EvidenceOption[];
  packId: string;
  runId: string;
};

export function CustomerConfirmationBackfillForm({
  evidences,
  packId,
  runId,
}: CustomerConfirmationBackfillFormProps) {
  return (
    <form className="phase9-form" action={recordCustomerConfirmationAction}>
      <input type="hidden" name="runId" value={runId} />
      <input type="hidden" name="packId" value={packId} />
      <select name="evidenceId" aria-label="回复证据" required>
        <option value="">选择 Evidence</option>
        {evidences.map((evidence) => (
          <option key={evidence.id} value={evidence.id}>
            {evidence.sourceLabel} · {evidence.redactedSummary}
          </option>
        ))}
      </select>
      <input name="confirmedByName" aria-label="客户确认人" placeholder="客户确认人" />
      <select name="coverageScopeType" aria-label="覆盖范围类型" defaultValue="">
        <option value="">选择覆盖范围类型</option>
        <option value="FULL_RUN">全 run</option>
        <option value="EMPLOYEES">部分员工</option>
        <option value="FIELDS">部分字段</option>
        <option value="CLIENT_SCOPE">客户口径</option>
        <option value="EXPORT_PREVIEW">导出预览</option>
        <option value="MIXED">混合范围</option>
      </select>
      <input name="employeeIds" aria-label="员工范围" placeholder="员工 IDs，逗号分隔" />
      <input name="fields" aria-label="字段范围" placeholder="字段列表，逗号分隔" />
      <input name="clientScopeKeys" aria-label="客户口径" placeholder="客户口径 keys，逗号分隔" />
      <input name="sourceObjectRefs" aria-label="来源对象范围" placeholder="来源对象，如 QUESTION_ITEM:id，逗号分隔" />
      <textarea name="confirmationText" aria-label="客户回复文本" placeholder="客户回复原文，如：确认无误" required />
      <button type="submit">回填客户确认</button>
    </form>
  );
}
