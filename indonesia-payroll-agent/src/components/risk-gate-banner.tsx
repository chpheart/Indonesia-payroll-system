import { AlertTriangle, ShieldAlert } from "lucide-react";

export function RiskGateBanner({
  blockingIssueCount,
  highRiskIssueCount,
  pendingCustomerConfirmationCount,
}: {
  blockingIssueCount: number;
  highRiskIssueCount: number;
  pendingCustomerConfirmationCount: number;
}) {
  const hasBlockers = blockingIssueCount > 0;
  const hasRisk = highRiskIssueCount > 0;
  const hasConfirmationGap = pendingCustomerConfirmationCount > 0;
  const tone = hasBlockers ? "danger" : hasRisk || hasConfirmationGap ? "warning" : "success";

  return (
    <section className={`risk-gate ${tone}`} aria-label="风险门禁">
      {tone === "success" ? (
        <ShieldAlert aria-hidden size={18} />
      ) : (
        <AlertTriangle aria-hidden size={18} />
      )}
      <div>
        <strong>
          {hasBlockers
            ? `${blockingIssueCount} 个阻断项未清零，无法继续高影响动作`
            : hasRisk
              ? `${highRiskIssueCount} 个高风险项等待人工放行`
              : hasConfirmationGap
                ? `${pendingCustomerConfirmationCount} 个客户确认缺口`
                : "当前门禁未发现阻断"}
        </strong>
        <p>
          {hasBlockers
            ? "先处理阻断项，预检查通过后才允许发起算薪、锁定或导出。"
            : hasRisk || hasConfirmationGap
              ? "需要展示影响范围、证据和业务理由，由有权限人员确认后才可继续。"
              : "仍需保留状态事件、审计记录和版本快照，不能跳过确认链。"}
        </p>
      </div>
    </section>
  );
}
