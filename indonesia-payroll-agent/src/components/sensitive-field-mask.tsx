import { EyeOff } from "lucide-react";

export function SensitiveFieldMask({
  label,
  maskedValue,
}: {
  label: string;
  maskedValue?: string | null;
}) {
  return (
    <span className="sensitive-mask">
      <EyeOff aria-hidden size={13} />
      <span>{label}：</span>
      <strong>{maskedValue ?? "-"}</strong>
    </span>
  );
}
