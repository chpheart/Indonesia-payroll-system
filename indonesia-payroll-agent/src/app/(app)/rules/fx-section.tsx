import {
  confirmFXRateAction,
  createFXRateDraftAction,
} from "@/app/(app)/rules/fx-actions";
import { statusClass, type ClientOption } from "@/app/(app)/rules/rules-data";

type FXRateRow = {
  id: string;
  payrollMonth: string;
  currencyCode: string;
  versionNumber: number;
  rate: unknown;
  status: string;
  evidenceRefs: string[];
  client: { code: string; name: string };
};

export function FXSection({
  canApprove,
  canConfigure,
  clients,
  fxRates,
}: {
  canApprove: boolean;
  canConfigure: boolean;
  clients: ClientOption[];
  fxRates: FXRateRow[];
}) {
  return (
    <section className="content-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">FX</p>
          <h2>汇率版本</h2>
        </div>
        <span className="risk-badge r2">R2 人工确认</span>
      </div>
      {canConfigure ? <FXCreateForm clients={clients} /> : null}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>客户/月度</th>
              <th>币种</th>
              <th>汇率</th>
              <th>状态</th>
              <th>证据</th>
              <th>动作</th>
            </tr>
          </thead>
          <tbody>
            {fxRates.map((rate) => (
              <tr key={rate.id}>
                <td><strong>{rate.client.code}</strong><span>{rate.payrollMonth}</span></td>
                <td>{rate.currencyCode}<span>v{rate.versionNumber}</span></td>
                <td>{String(rate.rate)}</td>
                <td><span className={`status-pill ${statusClass(rate.status)}`}>{rate.status}</span></td>
                <td>{rate.evidenceRefs.join(" · ") || "缺证据"}</td>
                <td>
                  {canApprove ? (
                    <form className="mini-version-form" action={confirmFXRateAction}>
                      <input type="hidden" name="fxRateVersionId" value={rate.id} />
                      <span className="stacked-text">
                        R2 汇率确认 · {rate.client.code} · {rate.payrollMonth} · {rate.currencyCode} v{rate.versionNumber}
                      </span>
                      <input name="confirmationText" placeholder="输入 CONFIRM_FX 确认" required />
                      <button disabled={rate.status === "CONFIRMED"} type="submit">确认汇率</button>
                    </form>
                  ) : "无审批权限"}
                </td>
              </tr>
            ))}
            {fxRates.length === 0 ? <tr><td colSpan={6}>暂无汇率版本。</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FXCreateForm({ clients }: { clients: ClientOption[] }) {
  return (
    <form className="inline-form rules-form" action={createFXRateDraftAction}>
      <select name="clientId" required aria-label="汇率客户">
        <option value="">客户</option>
        {clients.map((client) => (
          <option key={client.id} value={client.id}>{client.code} · {client.name}</option>
        ))}
      </select>
      <input name="payrollMonth" placeholder="YYYY-MM" required />
      <input name="currencyCode" placeholder="USD" required />
      <input name="rate" placeholder="汇率" required />
      <input name="evidenceRefs" placeholder="证据 ID，逗号分隔" required />
      <input name="sourceLabel" placeholder="来源" required />
      <input name="changeReason" placeholder="变更理由" required />
      <textarea name="employeeOverridesJson" placeholder='[{"employeeId":"...","rate":1,"evidenceRefs":["..."],"reason":"..."}]' />
      <button type="submit">创建汇率草稿</button>
    </form>
  );
}
