import { statusClass } from "@/app/(app)/rules/rules-data";

type AliasRow = {
  id: string;
  sourceLabel: string;
  normalizedLabel: string;
  effectiveMonth: string;
  status: string;
  versionNumber: number;
  client: { code: string };
  component: { code: string; name: string };
};

export function AliasSection({ aliases }: { aliases: AliasRow[] }) {
  return (
    <section className="content-section">
      <div className="section-header">
        <div>
          <p className="eyebrow">Alias Versions</p>
          <h2>客户别名版本队列</h2>
        </div>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th>客户</th><th>叫法</th><th>标准组件</th><th>状态</th><th>版本</th></tr>
          </thead>
          <tbody>
            {aliases.map((alias) => (
              <tr key={alias.id}>
                <td>{alias.client.code}<span>{alias.effectiveMonth}</span></td>
                <td><strong>{alias.sourceLabel}</strong><span>{alias.normalizedLabel}</span></td>
                <td>{alias.component.code}<span>{alias.component.name}</span></td>
                <td><span className={`status-pill ${statusClass(alias.status)}`}>{alias.status}</span></td>
                <td>v{alias.versionNumber}</td>
              </tr>
            ))}
            {aliases.length === 0 ? <tr><td colSpan={5}>暂无客户别名版本。</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
