import { currentActor } from "@/app/(app)/server-actor";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await currentActor();

  return <AppShell actor={actor}>{children}</AppShell>;
}
