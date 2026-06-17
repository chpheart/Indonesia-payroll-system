import Link from "next/link";
import {
  Archive,
  BookOpen,
  Bot,
  BriefcaseBusiness,
  ClipboardList,
  Home,
  Inbox,
  Landmark,
  Search,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { roleLabel } from "@/domain/auth/request-context";
import { type ActorContext } from "@/domain/auth/permissions";

const navItems = [
  { href: "/payroll-runs", label: "任务台", icon: Home },
  { href: "/intake", label: "AI Intake", icon: Inbox },
  { href: "/payroll-runs", label: "Payroll Runs", icon: ClipboardList },
  { href: "/clients", label: "客户", icon: Landmark },
  { href: "/employees", label: "员工", icon: UsersRound },
  { href: "/rules", label: "规则", icon: BookOpen },
  { href: "/agent-governance", label: "Agent 治理", icon: BriefcaseBusiness },
  { href: "/archives", label: "归档", icon: Archive },
  { href: "/audit", label: "审计", icon: ShieldCheck },
];

export function AppShell({
  actor,
  children,
}: {
  actor: ActorContext;
  children: React.ReactNode;
}) {
  const roleSummary =
    actor.roleCodes.length > 0
      ? actor.roleCodes.map((roleCode) => roleLabel(roleCode)).join(" / ")
      : "未登录 / 无角色";

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <div className="brand-block">
          <span className="brand-mark">P</span>
          <div>
            <p className="brand-title">Payroll Agent</p>
            <p className="brand-subtitle">Indonesia delivery control</p>
          </div>
        </div>
        <nav className="nav-list" aria-label="主导航">
          {navItems.map((item, index) => {
            const Icon = item.icon;
            const disabled = [5, 6, 7].includes(index);
            return disabled ? (
              <span className="nav-link disabled" key={`${item.href}-${item.label}`}>
                <Icon aria-hidden size={18} />
                <span>{item.label}</span>
              </span>
            ) : (
              <Link className="nav-link" href={item.href} key={`${item.href}-${item.label}`}>
                <Icon aria-hidden size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">高责任 Agent 工作台</p>
            <h1>Payroll Run 交付控制</h1>
          </div>
          <div className="topbar-tools">
            <form className="top-search" action="/employees" role="search">
              <Search aria-hidden size={15} />
              <input
                name="q"
                placeholder="搜索员工姓名 / ID / NIK / NPWP"
                aria-label="员工搜索"
              />
            </form>
            <span className="system-status">
              <span />
              系统正常
            </span>
            <div className="role-pill" title={actor.email}>
              <Bot aria-hidden size={14} />
              {roleSummary}
            </div>
          </div>
        </header>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}
