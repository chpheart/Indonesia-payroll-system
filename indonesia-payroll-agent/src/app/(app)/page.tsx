import Link from "next/link";
import { isSystemAdmin, type ActorContext } from "@/domain/auth/permissions";
import { currentActor } from "@/app/(app)/server-actor";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

async function loadPhaseTwoSummary(actor: ActorContext) {
  try {
    const clientWhere = isSystemAdmin(actor)
      ? undefined
      : { id: { in: actor.authorizedClientIds } };
    const employeeWhere = isSystemAdmin(actor)
      ? undefined
      : { clientId: { in: actor.authorizedClientIds } };
    const auditWhere = isSystemAdmin(actor)
      ? undefined
      : { clientId: { in: actor.authorizedClientIds } };
    const [clients, employees, audits] = await Promise.all([
      prisma.client.count({ where: clientWhere }),
      prisma.employee.count({ where: employeeWhere }),
      prisma.auditLog.count({ where: auditWhere }),
    ]);

    return { clients, employees, audits, error: null };
  } catch (error) {
    return {
      clients: 0,
      employees: 0,
      audits: 0,
      error: error instanceof Error ? error.message : "数据库连接失败",
    };
  }
}

export default async function PhaseTwoOverviewPage() {
  const actor = await currentActor();
  const summary = await loadPhaseTwoSummary(actor);

  return (
    <div className="page-stack">
      {summary.error ? <div className="alert error">数据库不可用：{summary.error}</div> : null}
      <section className="metric-grid" aria-label="Phase 2 指标">
        <div className="metric-card">
          <span>客户</span>
          <strong>{summary.clients}</strong>
          <p>客户状态、授权和配置版本</p>
        </div>
        <div className="metric-card">
          <span>员工</span>
          <strong>{summary.employees}</strong>
          <p>主档、敏感字段和版本证据</p>
        </div>
        <div className="metric-card">
          <span>审计</span>
          <strong>{summary.audits}</strong>
          <p>高影响动作、明文查看和追加更正</p>
        </div>
      </section>
      <section className="content-section">
        <div className="section-header">
          <div>
            <p className="eyebrow">Phase 2 门禁</p>
            <h2>先把边界钉牢，再推进 payroll run</h2>
          </div>
        </div>
        <div className="control-grid">
          <Link className="control-card" href="/clients">
            <strong>客户与配置版本</strong>
            <span>启停客户、查看授权、追踪配置版本。</span>
          </Link>
          <Link className="control-card" href="/employees">
            <strong>员工主档</strong>
            <span>默认脱敏，关键字段变更要求证据。</span>
          </Link>
          <Link className="control-card" href="/audit">
            <strong>不可变审计</strong>
            <span>查询高影响动作，只允许追加更正说明。</span>
          </Link>
        </div>
      </section>
    </div>
  );
}
