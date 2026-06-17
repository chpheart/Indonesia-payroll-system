import { actorHasPermission } from "@/domain/auth/permissions";
import { AliasSection } from "@/app/(app)/rules/alias-section";
import { ComponentSection } from "@/app/(app)/rules/component-section";
import { FXSection } from "@/app/(app)/rules/fx-section";
import { RuleVersionSection } from "@/app/(app)/rules/rule-version-section";
import { RulesMetrics } from "@/app/(app)/rules/rules-metrics";
import { currentActor } from "@/app/(app)/server-actor";
import { loadRulesData } from "@/app/(app)/rules/rules-data";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const actor = await currentActor();
  const canConfigure = actorHasPermission(actor, "rules.configure");
  const canApprove = actorHasPermission(actor, "rules.approve");
  const { clients, components, aliases, rules, fxRates, error } = await loadRulesData(actor);

  return (
    <div className="page-stack">
      <RulesMetrics components={components} rules={rules} fxRates={fxRates} />
      <ComponentSection
        canConfigure={canConfigure}
        clients={clients}
        components={components}
        error={error}
      />
      <RuleVersionSection
        canApprove={canApprove}
        canConfigure={canConfigure}
        clients={clients}
        components={components}
        rules={rules}
      />
      <FXSection
        canApprove={canApprove}
        canConfigure={canConfigure}
        clients={clients}
        fxRates={fxRates}
      />
      <AliasSection aliases={aliases} />
    </div>
  );
}
