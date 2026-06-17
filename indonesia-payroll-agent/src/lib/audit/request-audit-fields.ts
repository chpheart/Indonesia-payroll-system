import { type ActorContext } from "@/domain/auth/permissions";
import { prisma } from "@/lib/db/prisma";

type HeaderReader = {
  get(name: string): string | null;
};

export type RequestAuditFields = {
  actorUserId?: string;
  actorEmail: string;
  actorRoleCodes: string[];
  ipAddress?: string;
  userAgent?: string;
};

export async function requestAuditFields(
  actor: ActorContext,
  headers: HeaderReader,
): Promise<RequestAuditFields> {
  const actorUserId = await existingAuditActorUserId(actor);

  return {
    actorUserId,
    actorEmail: actor.email,
    actorRoleCodes: actor.roleCodes,
    ipAddress: requestIpAddress(headers),
    userAgent: headers.get("user-agent") ?? undefined,
  };
}

async function existingAuditActorUserId(actor: ActorContext) {
  if (actor.id === "anonymous") {
    return undefined;
  }

  const existingUser = await prisma.user.findUnique({
    where: { id: actor.id },
    select: { id: true, email: true },
  });

  if (!existingUser) {
    return undefined;
  }

  if (existingUser.email !== actor.email) {
    await prisma.user.update({
      where: { id: actor.id },
      data: { email: actor.email },
    });
  }

  return existingUser.id;
}

function requestIpAddress(headers: HeaderReader) {
  const forwardedFor = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwardedFor || headers.get("x-real-ip") || undefined;
}
