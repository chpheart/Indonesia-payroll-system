import { Link2, ShieldCheck } from "lucide-react";

export function EvidenceChip({
  label,
  status = "valid",
}: {
  label: string;
  status?: "valid" | "missing" | "stale";
}) {
  const Icon = status === "valid" ? ShieldCheck : Link2;

  return (
    <span className={`evidence-chip ${status}`}>
      <Icon aria-hidden size={12} />
      {label}
    </span>
  );
}
