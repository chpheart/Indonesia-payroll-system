import { LockKeyhole, ShieldCheck } from "lucide-react";

export function ApprovalDrawer({
  title,
  riskLabel,
  requiredRole,
  impactItems,
  reason,
}: {
  title: string;
  riskLabel: string;
  requiredRole: string;
  impactItems: string[];
  reason: string;
}) {
  return (
    <aside className="approval-drawer" aria-label={title}>
      <header>
        <div>
          <p className="eyebrow">高影响动作确认</p>
          <h2>{title}</h2>
        </div>
        <span className="risk-badge r3">{riskLabel}</span>
      </header>
      <div className="drawer-section">
        <strong>影响范围</strong>
        <ul>
          {impactItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <div className="drawer-warning">
        <LockKeyhole aria-hidden size={15} />
        <span>{reason}</span>
      </div>
      <footer>
        <span>
          <ShieldCheck aria-hidden size={15} />
          所需角色：{requiredRole}
        </span>
        <button disabled type="button">
          等待真实审批动作
        </button>
      </footer>
    </aside>
  );
}
