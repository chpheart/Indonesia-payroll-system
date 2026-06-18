import {
  approveRuleAction,
  createRuleDraftAction,
  recordRegressionRunAction,
} from "@/app/(app)/rules/rule-actions";
import { publishRuleAction } from "@/app/(app)/rules/rule-publish-action";
import {
  formatJsonKeys,
  statusClass,
  type ClientOption,
} from "@/app/(app)/rules/rules-data";

type ComponentOption = { id: string; code: string };
type RuleRow = {
  id: string;
  ruleKey: string;
  ruleType: string;
  scopeType: string;
  versionNumber: number;
  effectiveMonth: string;
  status: string;
  changeSummary: string;
  content: unknown;
  client?: { code: string } | null;
  component?: { code: string } | null;
  regressionRuns: {
    id: string;
    datasetCode: string;
    status: string;
    maxDiffIdr: unknown;
  }[];
};

export function RuleVersionSection({
  canApprove,
  canConfigure,
  clients,
  components,
  rules,
}: {
  canApprove: boolean;
  canConfigure: boolean;
  clients: ClientOption[];
  components: ComponentOption[];
  rules: RuleRow[];
}) {
  return (
    <section className="content-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Rule Versions</p>
          <h2>规则版本、审批与回归</h2>
        </div>
        <span className="risk-badge r3">R3 发布卡口</span>
      </div>
      {canConfigure ? (
        <RuleDraftForm clients={clients} components={components} />
      ) : null}
      <div className="table-wrap">
        <table className="data-table rules-table">
          <thead>
            <tr>
              <th>规则</th>
              <th>范围</th>
              <th>状态</th>
              <th>内容摘要</th>
              <th>回归</th>
              <th>受控动作</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((rule) => (
              <tr key={rule.id}>
                <td><strong>{rule.ruleKey}</strong><span>v{rule.versionNumber} · {rule.ruleType}</span></td>
                <td>{rule.client?.code ?? rule.component?.code ?? rule.scopeType}<span>{rule.effectiveMonth}</span></td>
                <td><span className={`status-pill ${statusClass(rule.status)}`}>{rule.status}</span></td>
                <td><span>{rule.changeSummary}</span><span>{formatJsonKeys(rule.content)}</span></td>
                <td><RegressionRuns runs={rule.regressionRuns} /></td>
                <td>
                  <RuleRowActions canApprove={canApprove} canConfigure={canConfigure} rule={rule} />
                </td>
              </tr>
            ))}
            {rules.length === 0 ? <tr><td colSpan={6}>暂无规则版本。</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RuleDraftForm({
  clients,
  components,
}: {
  clients: ClientOption[];
  components: ComponentOption[];
}) {
  return (
    <form className="inline-form rules-form" action={createRuleDraftAction}>
      <input name="ruleKey" placeholder="规则键，如 PPH21_TER" required />
      <select name="ruleType" defaultValue="PPH21" aria-label="规则类型">
        <option value="PPH21">PPh21</option>
        <option value="BPJS">BPJS</option>
        <option value="THR">THR</option>
        <option value="GROSS_UP">Gross Up</option>
        <option value="FX">FX</option>
        <option value="ROUNDING">Rounding</option>
        <option value="CUSTOMER_POLICY">客户口径</option>
        <option value="COMPONENT_CLASSIFICATION">组件分类</option>
      </select>
      <select name="scopeType" defaultValue="PUBLIC" aria-label="范围">
        <option value="PUBLIC">公共</option>
        <option value="CUSTOMER">客户</option>
        <option value="COMPONENT">组件</option>
      </select>
      <select name="clientId" aria-label="客户范围">
        <option value="">非客户规则</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>{client.code}</option>
        ))}
      </select>
      <select name="componentId" aria-label="组件范围">
        <option value="">非组件规则</option>
        {components.map((component) => (
          <option key={component.id} value={component.id}>{component.code}</option>
        ))}
      </select>
      <input name="effectiveMonth" placeholder="YYYY-MM" required />
      <textarea name="contentJson" placeholder='{"parameter":"value"}' />
      <textarea name="conflictCheckJson" placeholder='{"hasBlockingConflict":false}' />
      <input name="changeSummary" placeholder="变更说明" required />
      <button type="submit">起草规则</button>
    </form>
  );
}

function RegressionRuns({ runs }: { runs: RuleRow["regressionRuns"] }) {
  if (runs.length === 0) {
    return <>未跑回归</>;
  }
  return runs.map((run) => (
    <span className="stacked-text" key={run.id}>
      {run.datasetCode} · {run.status} · diff {String(run.maxDiffIdr)}
    </span>
  ));
}

function RuleRowActions({
  canApprove,
  canConfigure,
  rule,
}: {
  canApprove: boolean;
  canConfigure: boolean;
  rule: RuleRow;
}) {
  return (
    <div className="action-stack">
      {canApprove ? <ApprovalForm ruleId={rule.id} /> : null}
      {canConfigure ? <RegressionForm ruleId={rule.id} /> : null}
      {canApprove ? (
        <form className="mini-version-form" action={publishRuleAction}>
          <input type="hidden" name="ruleVersionId" value={rule.id} />
          <span className="stacked-text">
            R3 发布确认 · {rule.ruleKey} v{rule.versionNumber} · 蓝色光标/三福回归将写入审计
          </span>
          <input name="confirmationText" placeholder="输入 PUBLISH 确认发布" required />
          <button disabled={rule.status === "PUBLISHED"} type="submit">发布版本</button>
        </form>
      ) : null}
    </div>
  );
}

function ApprovalForm({ ruleId }: { ruleId: string }) {
  return (
    <form className="mini-version-form" action={approveRuleAction}>
      <input type="hidden" name="ruleVersionId" value={ruleId} />
      <select name="decision" defaultValue="APPROVED" aria-label="审批结论">
        <option value="APPROVED">批准</option>
        <option value="REJECTED">拒绝</option>
      </select>
      <input name="note" placeholder="审批备注" required />
      <button type="submit">记录审批</button>
    </form>
  );
}

function RegressionForm({ ruleId }: { ruleId: string }) {
  return (
    <form className="mini-version-form" action={recordRegressionRunAction}>
      <input type="hidden" name="ruleVersionId" value={ruleId} />
      <select name="datasetCode" defaultValue="BLUE_FOCUS" aria-label="回归样例">
        <option value="BLUE_FOCUS">蓝色光标</option>
        <option value="SANFU">三福</option>
      </select>
      <input name="scenarioName" placeholder="场景名" required />
      <input name="expectedEmployeeCount" placeholder="期望人数" required />
      <input name="actualEmployeeCount" placeholder="实际人数" required />
      <input name="maxDiffIdr" placeholder="最大差异 IDR" required />
      <button type="submit">记录回归</button>
    </form>
  );
}
