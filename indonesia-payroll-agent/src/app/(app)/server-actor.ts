import { headers } from "next/headers";
import { actorFromHeadersWithDatabase } from "@/domain/auth/request-context";
import { requestAuditFields } from "@/lib/audit/request-audit-fields";

export async function currentActor() {
  return actorFromHeadersWithDatabase(await headers());
}

export async function currentRequestContext() {
  const requestHeaders = await headers();
  const actor = await actorFromHeadersWithDatabase(requestHeaders);

  return {
    actor,
    auditFields: await requestAuditFields(actor, requestHeaders),
  };
}
