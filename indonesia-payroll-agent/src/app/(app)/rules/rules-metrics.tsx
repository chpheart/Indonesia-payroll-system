type RuleMetricInput = {
  components: unknown[];
  rules: { status: string; regressionRuns: { status: string }[] }[];
  fxRates: { status: string }[];
};

export function RulesMetrics({ components, rules, fxRates }: RuleMetricInput) {
  const blockedRegressionCount = rules.flatMap((rule) => rule.regressionRuns).filter((run) =>
    ["FAILED", "BLOCKED"].includes(run.status),
  ).length;
  const metrics = [
    ["组件字典", components.length, "系统级"],
    ["规则草稿", rules.filter((rule) => rule.status === "DRAFT").length, "不可引用"],
    ["回归阻断", blockedRegressionCount, "发布卡口"],
    ["未确认汇率", fxRates.filter((rate) => rate.status !== "CONFIRMED").length, "预检查阻断"],
  ];

  return (
    <div className="metric-grid run-metrics" aria-label="规则治理指标">
      {metrics.map(([label, value, note]) => (
        <div className="metric-card" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
          <p>{note}</p>
        </div>
      ))}
    </div>
  );
}
