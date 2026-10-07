import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { filled?: boolean };

function base({ filled, ...p }: P) {
  return {
    width: 24,
    height: 24,
    viewBox: "0 0 24 24",
    fill: filled ? "currentColor" : "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...p,
  };
}

export const StarIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6L3.3 9.3l6.1-.7L12 3Z" />
  </svg>
);
export const TagIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z" />
    <circle cx="8" cy="8" r="1.2" fill="currentColor" />
  </svg>
);
export const LinkIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </svg>
);
export const TrashIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3" />
  </svg>
);
export const ShuffleIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 7h3a5 5 0 0 1 4 2l4 6a5 5 0 0 0 4 2h3M3 17h3a5 5 0 0 0 4-2M14 9a5 5 0 0 1 4-2h3M18 4l3 3-3 3M18 14l3 3-3 3" />
  </svg>
);
export const FeedIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="6" y="3" width="12" height="18" rx="3" />
    <path d="M10 9l4 3-4 3V9Z" fill="currentColor" />
  </svg>
);
export const PlusIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);
export const LibraryIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M5 4v16M10 4v16M15 5l4 14M3 20h18" />
  </svg>
);
export const GridIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <rect x="13" y="13" width="7" height="7" rx="1.5" />
  </svg>
);
