import { DomainsManager } from "@/components/DomainsManager";
import { LogoutButton } from "@/components/LogoutButton";
import { PageShell } from "@/components/PageShell";

export default function DomainsPage() {
  return (
    <PageShell title="Domains" subtitle="The topics your cards are filed under. Claude picks from these.">
      <DomainsManager />
      <div className="mt-10 border-t border-white/10 pt-6">
        <LogoutButton />
      </div>
    </PageShell>
  );
}
