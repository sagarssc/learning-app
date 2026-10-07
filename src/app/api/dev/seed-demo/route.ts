import { seedDemoDeck } from "@/lib/demo";

// Development helper only: loads a small multi-domain deck so the feed can be tried
// without spending Claude credits. Disabled in production builds.
export async function POST() {
  if (process.env.NODE_ENV === "production") return new Response("Not found", { status: 404 });
  return Response.json(await seedDemoDeck());
}
