// Shapes shared by API routes (server) and UI (client). No server-only imports here.

export type CardKind = "qa" | "note";
export type ResourceType = "pdf" | "url" | "text";
export type ResourceStatus = "queued" | "processing" | "ready" | "failed";

export type DomainTag = { id: string; slug: string; name: string; color: string };

export type DomainDTO = DomainTag & { description: string; cardCount: number };

export type FeedCard = {
  id: string;
  kind: CardKind;
  question: string | null;
  body: string;
  sourceRef: string | null;
  starred: boolean;
  resource: {
    id: string;
    title: string;
    type: ResourceType;
    sourceUrl: string | null;
    blobUrl: string | null;
  };
  domains: DomainTag[];
};

export type CardsPage = { cards: FeedCard[]; hasMore: boolean };

export type ResourceDTO = {
  id: string;
  type: ResourceType;
  title: string;
  sourceUrl: string | null;
  blobUrl: string | null;
  status: ResourceStatus;
  chunksTotal: number;
  chunksDone: number;
  error: string | null;
  suggestedDomains: string[];
  cardCount: number;
  domains: DomainTag[];
  createdAt: string;
};
