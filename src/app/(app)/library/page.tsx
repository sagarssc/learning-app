import { Library } from "@/components/Library";
import { PageShell } from "@/components/PageShell";

export default function LibraryPage() {
  return (
    <PageShell title="Library" subtitle="Everything you’ve added, and what Claude made from it.">
      <Library />
    </PageShell>
  );
}
