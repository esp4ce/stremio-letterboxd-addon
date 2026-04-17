export interface BaseCatalogDef {
  id: string;
  key: string;
  label: string;
  description: string;
}

export type ActiveCatalogItem =
  | { id: string; type: "base"; key: string; label: string; description: string }
  | { id: string; type: "ownList"; listId: string; label: string; filmCount: number }
  | { id: string; type: "externalList"; list: { id: string; name: string; owner: string; filmCount: number } }
  | { id: string; type: "externalWatchlist"; watchlist: { username: string; displayName: string } }
  | { id: string; type: "contributor"; contributor: { id: string; name: string; kind: 'director' | 'actor' | 'studio' } }
  | { id: string; type: "variant"; baseCatalogId: string; variantKey: string; label: string };
