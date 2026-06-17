import { Calculator } from "lucide-react";

export function CalculationTracePanel({
  status,
  lines,
}: {
  status: string;
  lines: string[];
}) {
  return (
    <section className="trace-panel" aria-label="计算 Trace">
      <div className="trace-heading">
        <Calculator aria-hidden size={16} />
        <strong>计算 Trace</strong>
        <span>{status}</span>
      </div>
      <ul>
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}
