import {
  createComponentAliasAction,
  createPayrollComponentAction,
} from "@/app/(app)/rules/component-actions";
import { type ClientOption } from "@/app/(app)/rules/rules-data";

type ComponentRow = {
  id: string;
  code: string;
  name: string;
  componentType: string;
  taxableCash: boolean;
  bpjsHealthBase: boolean;
  bpjsEmploymentBase: boolean;
  paidOut: boolean;
  affectsNetPay: boolean;
};

type ComponentSectionProps = {
  canConfigure: boolean;
  clients: ClientOption[];
  components: ComponentRow[];
  error: string | null;
};

export function ComponentSection({
  canConfigure,
  clients,
  components,
  error,
}: ComponentSectionProps) {
  return (
    <section className="content-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Phase 5</p>
          <h2>薪资组件与客户别名</h2>
        </div>
        <span className="risk-badge r2">R2 映射预填</span>
      </div>
      {error ? <div className="alert error">数据库不可用：{error}</div> : null}
      {canConfigure ? <ComponentCreateForm /> : null}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>组件</th>
              <th>属性</th>
              <th>客户别名草稿</th>
            </tr>
          </thead>
          <tbody>
            {components.map((component) => (
              <tr key={component.id}>
                <td>
                  <strong>{component.code}</strong>
                  <span>{component.name} · {component.componentType}</span>
                </td>
                <td>
                  <span>{component.taxableCash ? "入税" : "不入税"}</span>
                  <span>
                    {component.bpjsHealthBase ? "KS" : "非 KS"} ·{" "}
                    {component.bpjsEmploymentBase ? "TK" : "非 TK"}
                  </span>
                  <span>
                    {component.paidOut ? "发放" : "不发放"} ·{" "}
                    {component.affectsNetPay ? "影响实发" : "不影响实发"}
                  </span>
                </td>
                <td>
                  {canConfigure ? (
                    <AliasCreateForm clients={clients} componentId={component.id} />
                  ) : (
                    "无规则配置权限"
                  )}
                </td>
              </tr>
            ))}
            {components.length === 0 ? (
              <tr><td colSpan={3}>暂无组件字典。</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ComponentCreateForm() {
  return (
    <form className="inline-form rules-form" action={createPayrollComponentAction}>
      <input name="code" placeholder="组件编码" required />
      <input name="name" placeholder="组件名称" required />
      <select name="componentType" defaultValue="EARNING" aria-label="组件类型">
        <option value="EARNING">收入</option>
        <option value="DEDUCTION">扣款</option>
        <option value="TAX_ALLOWANCE">Tax Allowance</option>
        <option value="BENEFIT">福利</option>
        <option value="EMPLOYER_COST">雇主成本</option>
        <option value="MEMO">备注</option>
      </select>
      <input name="effectiveMonth" placeholder="YYYY-MM" />
      <label className="checkbox-line"><input name="taxableCash" type="checkbox" />入税</label>
      <label className="checkbox-line"><input name="bpjsHealthBase" type="checkbox" />入 BPJS KS</label>
      <label className="checkbox-line"><input name="bpjsEmploymentBase" type="checkbox" />入 BPJS TK</label>
      <label className="checkbox-line"><input name="paidOut" defaultChecked type="checkbox" />发放</label>
      <label className="checkbox-line"><input name="affectsNetPay" defaultChecked type="checkbox" />影响实发</label>
      <label className="checkbox-line"><input name="affectsEmployerCost" type="checkbox" />雇主成本</label>
      <button type="submit">新增组件</button>
    </form>
  );
}

function AliasCreateForm({
  clients,
  componentId,
}: {
  clients: ClientOption[];
  componentId: string;
}) {
  return (
    <form className="mini-version-form" action={createComponentAliasAction}>
      <input type="hidden" name="componentId" value={componentId} />
      <select name="clientId" required aria-label="别名客户">
        <option value="">客户</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>{client.code}</option>
        ))}
      </select>
      <input name="sourceLabel" placeholder="客户原始叫法" required />
      <input name="effectiveMonth" placeholder="YYYY-MM" required />
      <input name="evidenceRefs" placeholder="证据 ID，逗号分隔" />
      <input name="changeReason" placeholder="别名变更理由" required />
      <button type="submit">生成别名版本</button>
    </form>
  );
}
