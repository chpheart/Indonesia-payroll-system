import { type ReactNode } from "react";
import { EvidenceChip } from "@/components/evidence-chip";

export type ChangeProposalRowData = {
  id: string;
  source: string;
  reason: string;
  proposalType: string;
  targetObjectType: string;
  targetField: string;
  previousValue: unknown;
  proposedValue: unknown;
  effectiveFrom: string;
  effectiveTo?: string | null;
  riskLevel: string;
  confidence: string;
  evidenceRefs: string[];
  status: string;
  reviewNote?: string | null;
  rawInputItem?: { redactedSummary: string } | null;
  targetEmployee?: { employeeCode: string; fullName: string } | null;
  ledgerEntry?: { id: string } | null;
  permissionGate: string;
  customerConfirmationGate: string;
};

export function ChangeProposalRow({
  proposal,
  statusLabel,
  actions,
}: {
  proposal: ChangeProposalRowData;
  statusLabel: string;
  actions: ReactNode;
}) {
  return (
    <tr>
      <td>
        <strong>{proposal.source}</strong>
        <span>{proposal.rawInputItem?.redactedSummary ?? proposal.reason}</span>
        <span>
          {proposal.targetEmployee
            ? `${proposal.targetEmployee.employeeCode} · ${proposal.targetEmployee.fullName}`
            : proposal.targetObjectType}
        </span>
      </td>
      <td>
        <strong>{proposal.proposalType}</strong>
        <span>{proposal.targetField}</span>
        <span>
          {proposal.effectiveFrom}
          {proposal.effectiveTo ? ` - ${proposal.effectiveTo}` : ""}
        </span>
      </td>
      <td>
        <span className="stacked-text">原值：{formatJson(proposal.previousValue)}</span>
        <span className="stacked-text">新值：{formatJson(proposal.proposedValue)}</span>
      </td>
      <td>
        <span className={`risk-badge ${proposal.riskLevel.toLowerCase()}`}>{proposal.riskLevel}</span>
        <span className="status-pill">{proposal.confidence}</span>
        <span className="stacked-text">权限：{proposal.permissionGate}</span>
        <span className="stacked-text">客户确认：{proposal.customerConfirmationGate}</span>
        <div className="evidence-strip">
          {proposal.evidenceRefs.length > 0 ? (
            proposal.evidenceRefs.slice(0, 3).map((ref) => <EvidenceChip key={ref} label={ref} />)
          ) : (
            <EvidenceChip label="缺证据" status="missing" />
          )}
        </div>
      </td>
      <td>
        <strong>{statusLabel}</strong>
        {actions}
      </td>
    </tr>
  );
}

function formatJson(value: unknown) {
  return JSON.stringify(value).slice(0, 160);
}
