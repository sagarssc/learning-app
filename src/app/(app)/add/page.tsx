import { AddResource } from "@/components/AddResource";
import { PageShell } from "@/components/PageShell";

export default function AddPage() {
  return (
    <PageShell title="Add to your feed" subtitle="Drop in a link, a PDF, or some text.">
      <AddResource />
    </PageShell>
  );
}
