import { BottomNav } from "@/components/BottomNav";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex h-dvh flex-col">
      <main className="relative min-h-0 flex-1">{children}</main>
      <BottomNav />
    </div>
  );
}
