import { Suspense } from "react";
import { Feed } from "@/components/feed/Feed";

export default function FeedPage() {
  // Feed reads the URL (domain filter, shuffle) on the client, hence the Suspense boundary.
  return (
    <Suspense>
      <Feed />
    </Suspense>
  );
}
