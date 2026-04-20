"use client";

import { useState } from "react";
import type { UserPreferences } from "../../types/preferences";
import {
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates, arrayMove } from "@dnd-kit/sortable";
import { Toggle } from "./components/primitives";
import {
  ALL_BASE_DEFS,
  SORT_VARIANT_OPTIONS,
  PUBLIC_SORT_VARIANT_OPTIONS,
  TRASH_PATH,
  CATALOG_KEY_TO_ID,
} from "./components/constants";
import type { ActiveCatalogItem } from "./components/types";
import { CatalogsSection } from "./components/CatalogsSection";
import { DisplayOptionsSection } from "./components/DisplayOptionsSection";
import { ExternalCatalogsSection } from "./components/ExternalCatalogsSection";
import { UserListsSection } from "./components/UserListsSection";

interface BaseProps {
  user?: { username: string; displayName: string | null };
  lists: Array<{ id: string; name: string; filmCount: number }>;
  onBack: () => void;
  onSave: () => void;
  isSaving: boolean;
  externalListUrl: string;
  onExternalListUrlChange: (url: string) => void;
  onAddExternalList: () => void;
  isResolvingList: boolean;
}

interface FullModeProps extends BaseProps {
  mode: "full";
  preferences: UserPreferences;
  onPreferencesChange: (prefs: UserPreferences) => void;
  sortVariants: Record<string, string[]>;
  onSortVariantsChange: (variants: Record<string, string[]>) => void;
}

interface PublicModeProps extends BaseProps {
  mode: "public";
  publicCatalogs: { popular: boolean; top250: boolean };
  onPublicCatalogsChange: (cats: { popular: boolean; top250: boolean }) => void;
  publicWatchlist: boolean;
  onPublicWatchlistChange: (val: boolean) => void;
  publicLikedFilms: boolean;
  onPublicLikedFilmsChange: (val: boolean) => void;
  publicOwnLists: string[];
  onPublicOwnListsChange: (ids: string[]) => void;
  publicLists: Array<{ id: string; name: string; owner: string; filmCount: number }>;
  onRemovePublicList: (id: string) => void;
  publicExternalWatchlists: Array<{ username: string; displayName: string }>;
  onRemovePublicExternalWatchlist: (username: string) => void;
  publicContributors: Array<{ id: string; name: string; kind: 'director' | 'actor' | 'studio' }>;
  onRemovePublicContributor: (id: string, kind: 'director' | 'actor' | 'studio') => void;
  showRatings: boolean;
  onShowRatingsChange: (val: boolean) => void;
  hideUnreleased: boolean;
  onHideUnreleasedChange: (val: boolean) => void;
  publicSearch: boolean;
  onPublicSearchChange: (val: boolean) => void;
  publicCatalogNames: Record<string, string>;
  onPublicCatalogNamesChange: (names: Record<string, string>) => void;
  publicCatalogOrder: string[];
  onPublicCatalogOrderChange: (order: string[]) => void;
  publicSortVariants: Record<string, string[]>;
  onPublicSortVariantsChange: (variants: Record<string, string[]>) => void;
}

type ConfigurationModalProps = FullModeProps | PublicModeProps;

export default function ConfigurationModal(props: ConfigurationModalProps) {
  const { mode, user, lists, onBack, onSave, isSaving, externalListUrl, onExternalListUrlChange, onAddExternalList, isResolvingList } = props;

  const isPublic = mode === "public";
  const hasUsername = !!user;

  // Catalog name editing state
  const [editingCatalogId, setEditingCatalogId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  // Sort variant expansion state
  const [expandedVariantCatalog, setExpandedVariantCatalog] = useState<string | null>(null);

  // DnD sensors — drag only activates from the grip handle
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );


  // ── Catalog order helpers ─────────────────────────────────────────────────

  const getCatalogOrder = (): string[] => {
    if (isPublic) return (props as PublicModeProps).publicCatalogOrder;
    return (props as FullModeProps).preferences.catalogOrder ?? [];
  };

  const setCatalogOrder = (order: string[]) => {
    if (isPublic) {
      (props as PublicModeProps).onPublicCatalogOrderChange(order);
    } else {
      const p = props as FullModeProps;
      p.onPreferencesChange({ ...p.preferences, catalogOrder: order });
    }
  };

  // ── Sort variant helpers ─────────────────────────────────────────────────

  const getSortVariants = (): Record<string, string[]> => {
    if (isPublic) return (props as PublicModeProps).publicSortVariants;
    return (props as FullModeProps).sortVariants;
  };

  /**
   * Remove a catalog from order + sortVariants.
   * @param keepVariants – when true, variant children are kept as orphans.
   *   The backend resolves orphan variants from its template map for all catalog types.
   */
  const stripCatalogAndVariants = (
    catId: string,
    order: string[],
    variants: Record<string, string[]>,
    keepVariants = false,
  ): { newOrder: string[]; newVariants: Record<string, string[]> } => {
    const prefix = `${catId}--`;
    const newOrder = keepVariants
      ? order.filter((id) => id !== catId)
      : order.filter((id) => id !== catId && !id.startsWith(prefix));
    const newVariants = { ...variants };
    if (!keepVariants) delete newVariants[catId];
    return { newOrder, newVariants };
  };

  const getCatalogVariants = (catalogId: string): string[] => {
    return getSortVariants()[catalogId] || [];
  };

  const toggleCatalogVariant = (catalogId: string, variantKey: string) => {
    const current = getSortVariants();
    const catalogVariants = current[catalogId] || [];
    const enabling = !catalogVariants.includes(variantKey);
    const updated = enabling
      ? [...catalogVariants, variantKey]
      : catalogVariants.filter((k) => k !== variantKey);
    const nextVariants = { ...current };
    if (updated.length > 0) {
      nextVariants[catalogId] = updated;
    } else {
      delete nextVariants[catalogId];
    }

    // Compute new catalog order
    const variantCatId = `${catalogId}--${variantKey}`;
    const currentOrder = getCatalogOrder();
    const newOrder = enabling
      ? (() => {
          const baseIdx = currentOrder.indexOf(catalogId);
          const o = [...currentOrder];
          o.splice(baseIdx >= 0 ? baseIdx + 1 : o.length, 0, variantCatId);
          return o;
        })()
      : currentOrder.filter((id) => id !== variantCatId);

    // When removing the last variant of an orphan catalog, clean up the external list/watchlist metadata
    const isOrphan = updated.length === 0 && !newOrder.includes(catalogId);

    // Update both in a single state change to avoid stale overwrites
    if (isPublic) {
      if (isOrphan && catalogId.startsWith('letterboxd-list-'))
        (props as PublicModeProps).onRemovePublicList(catalogId.replace('letterboxd-list-', ''));
      if (isOrphan && catalogId.startsWith('letterboxd-watchlist-'))
        (props as PublicModeProps).onRemovePublicExternalWatchlist(catalogId.replace('letterboxd-watchlist-', ''));
      if (isOrphan && catalogId.startsWith('letterboxd-contributor-')) {
        const m = catalogId.match(/^letterboxd-contributor-([das])-(.+)$/);
        if (m) {
          const kindMap = { d: 'director', a: 'actor', s: 'studio' } as const;
          (props as PublicModeProps).onRemovePublicContributor(m[2]!, kindMap[m[1] as 'd' | 'a' | 's']);
        }
      }
      (props as PublicModeProps).onPublicSortVariantsChange(nextVariants);
      (props as PublicModeProps).onPublicCatalogOrderChange(newOrder);
    } else {
      const p = props as FullModeProps;
      const patch: Partial<typeof p.preferences> = { sortVariants: nextVariants, catalogOrder: newOrder };
      if (isOrphan && catalogId.startsWith('letterboxd-list-')) {
        const listId = catalogId.replace('letterboxd-list-', '');
        patch.externalLists = p.preferences.externalLists.filter((l) => l.id !== listId);
      }
      if (isOrphan && catalogId.startsWith('letterboxd-watchlist-')) {
        const username = catalogId.replace('letterboxd-watchlist-', '');
        patch.externalWatchlists = (p.preferences.externalWatchlists || []).filter((w) => w.username !== username);
      }
      if (isOrphan && catalogId.startsWith('letterboxd-contributor-')) {
        const m = catalogId.match(/^letterboxd-contributor-([das])-(.+)$/);
        if (m) {
          const t = m[1] as 'd' | 'a' | 's';
          patch.contributors = (p.preferences.contributors || []).filter((c) => !(c.t === t && c.id === m[2]));
        }
      }
      p.onPreferencesChange({ ...p.preferences, ...patch });
    }
  };

  // Catalogs that support genre/decade filtering (and thus sort variants)
  const canHaveVariants = (catalogId: string): boolean => {
    return catalogId === 'letterboxd-watchlist'
      || catalogId === 'letterboxd-liked-films'
      || catalogId === 'letterboxd-popular'
      || catalogId === 'letterboxd-top250'
      || catalogId.startsWith('letterboxd-list-')
      || catalogId.startsWith('letterboxd-watchlist-')
      || catalogId.startsWith('letterboxd-contributor-');
  };

  const availableVariantOptions = isPublic ? PUBLIC_SORT_VARIANT_OPTIONS : SORT_VARIANT_OPTIONS;

  // ── Catalog name helpers ──────────────────────────────────────────────────

  const getCatalogDisplayName = (catalogId: string, defaultName: string): string => {
    if (isPublic) {
      return (props as PublicModeProps).publicCatalogNames[catalogId] || defaultName;
    }
    const p = props as FullModeProps;
    return p.preferences.catalogNames?.[catalogId] || defaultName;
  };

  const startEditingCatalogName = (catalogId: string, currentName: string) => {
    setEditingCatalogId(catalogId);
    setEditingName(currentName);
  };

  const saveCatalogName = (catalogId: string, defaultName: string) => {
    const trimmed = editingName.trim();
    const computeNames = (current: Record<string, string> | undefined): Record<string, string> => {
      const newNames = { ...current };
      if (!trimmed || trimmed === defaultName) {
        delete newNames[catalogId];
      } else {
        newNames[catalogId] = trimmed;
      }
      return newNames;
    };

    if (isPublic) {
      const p = props as PublicModeProps;
      p.onPublicCatalogNamesChange(computeNames(p.publicCatalogNames));
    } else {
      const p = props as FullModeProps;
      const newNames = computeNames(p.preferences.catalogNames);
      p.onPreferencesChange({ ...p.preferences, catalogNames: Object.keys(newNames).length > 0 ? newNames : undefined });
    }
    setEditingCatalogId(null);
  };

  // ── Enabled state ─────────────────────────────────────────────────────────

  const getCatalogEnabled = (key: string): boolean => {
    if (isPublic) {
      const p = props as PublicModeProps;
      if (key === "popular") return p.publicCatalogs.popular;
      if (key === "top250") return p.publicCatalogs.top250;
      if (key === "watchlist") return hasUsername ? p.publicWatchlist : false;
      if (key === "likedFilms") return hasUsername ? p.publicLikedFilms : false;
      return false;
    }
    const p = props as FullModeProps;
    return p.preferences.catalogs[key as keyof UserPreferences["catalogs"]] ?? false;
  };

  // ── Toggle handlers ───────────────────────────────────────────────────────

  const toggleCatalog = (key: string) => {
    const catalogId = CATALOG_KEY_TO_ID[key]!;
    const enabling = !getCatalogEnabled(key);
    const currentOrder = getCatalogOrder();

    if (enabling) {
      const newOrder = [...currentOrder, catalogId];
      if (isPublic) {
        const p = props as PublicModeProps;
        if (key === "popular" || key === "top250") p.onPublicCatalogsChange({ ...p.publicCatalogs, [key]: true });
        if (key === "watchlist" && hasUsername) p.onPublicWatchlistChange(true);
        if (key === "likedFilms" && hasUsername) p.onPublicLikedFilmsChange(true);
        p.onPublicCatalogOrderChange(newOrder);
        return;
      }
      const p = props as FullModeProps;
      p.onPreferencesChange({ ...p.preferences, catalogs: { ...p.preferences.catalogs, [key]: true }, catalogOrder: newOrder });
    } else {
      const { newOrder, newVariants } = stripCatalogAndVariants(catalogId, currentOrder, getSortVariants(), catalogHasVariants(catalogId));
      if (isPublic) {
        const p = props as PublicModeProps;
        if (key === "popular" || key === "top250") p.onPublicCatalogsChange({ ...p.publicCatalogs, [key]: false });
        if (key === "watchlist" && hasUsername) p.onPublicWatchlistChange(false);
        if (key === "likedFilms" && hasUsername) p.onPublicLikedFilmsChange(false);
        p.onPublicSortVariantsChange(newVariants);
        p.onPublicCatalogOrderChange(newOrder);
        return;
      }
      const p = props as FullModeProps;
      p.onPreferencesChange({
        ...p.preferences,
        catalogs: { ...p.preferences.catalogs, [key]: false },
        sortVariants: newVariants,
        catalogOrder: newOrder,
      });
    }
  };

  const toggleOwnList = (listId: string) => {
    const catId = `letterboxd-list-${listId}`;
    const isSelected = isOwnListSelected(listId);
    const currentOrder = getCatalogOrder();

    if (!isSelected) {
      const newOrder = [...currentOrder, catId];
      if (isPublic) {
        const p = props as PublicModeProps;
        p.onPublicOwnListsChange([...p.publicOwnLists, listId]);
        p.onPublicCatalogOrderChange(newOrder);
        return;
      }
      const p = props as FullModeProps;
      p.onPreferencesChange({ ...p.preferences, ownLists: [...p.preferences.ownLists, listId], catalogOrder: newOrder });
    } else {
      const { newOrder, newVariants } = stripCatalogAndVariants(catId, currentOrder, getSortVariants(), true);
      if (isPublic) {
        const p = props as PublicModeProps;
        p.onPublicOwnListsChange(p.publicOwnLists.filter((id) => id !== listId));
        p.onPublicSortVariantsChange(newVariants);
        p.onPublicCatalogOrderChange(newOrder);
        return;
      }
      const p = props as FullModeProps;
      p.onPreferencesChange({
        ...p.preferences,
        ownLists: p.preferences.ownLists.filter((id) => id !== listId),
        sortVariants: newVariants,
        catalogOrder: newOrder,
      });
    }
  };

  const selectAllOwnLists = () => {
    const allIds = lists.map((l) => l.id);
    const currentOrder = getCatalogOrder();
    const existingSet = new Set(currentOrder);
    const newItems = allIds.map((id) => `letterboxd-list-${id}`).filter((catId) => !existingSet.has(catId));
    const newOrder = [...currentOrder, ...newItems];
    if (isPublic) {
      (props as PublicModeProps).onPublicOwnListsChange(allIds);
      (props as PublicModeProps).onPublicCatalogOrderChange(newOrder);
      return;
    }
    const p = props as FullModeProps;
    p.onPreferencesChange({ ...p.preferences, ownLists: allIds, catalogOrder: newOrder });
  };

  const deselectAllOwnLists = () => {
    const ownListCatIds = new Set(lists.map((l) => `letterboxd-list-${l.id}`));
    // Remove only base catalogs, keep variant children as orphans (backend supports them)
    const newOrder = getCatalogOrder().filter(
      (id) => !ownListCatIds.has(id),
    );
    const newVariants = { ...getSortVariants() };
    if (isPublic) {
      const p = props as PublicModeProps;
      p.onPublicOwnListsChange([]);
      p.onPublicSortVariantsChange(newVariants);
      p.onPublicCatalogOrderChange(newOrder);
      return;
    }
    const p = props as FullModeProps;
    p.onPreferencesChange({ ...p.preferences, ownLists: [], sortVariants: newVariants, catalogOrder: newOrder });
  };

  const isOwnListSelected = (listId: string): boolean => {
    if (isPublic) return (props as PublicModeProps).publicOwnLists.includes(listId);
    return (props as FullModeProps).preferences.ownLists.includes(listId);
  };

  const catalogHasVariants = (catalogId: string): boolean => {
    const variants = getSortVariants()[catalogId];
    return !!variants && variants.length > 0;
  };

  const removeExternalList = (listId: string) => {
    const catId = `letterboxd-list-${listId}`;
    const hasVariants = catalogHasVariants(catId);
    const { newOrder, newVariants } = stripCatalogAndVariants(catId, getCatalogOrder(), getSortVariants(), hasVariants);
    if (isPublic) {
      const p = props as PublicModeProps;
      if (!hasVariants) p.onRemovePublicList(listId);
      p.onPublicSortVariantsChange(newVariants);
      p.onPublicCatalogOrderChange(newOrder);
      return;
    }
    const p = props as FullModeProps;
    p.onPreferencesChange({
      ...p.preferences,
      externalLists: hasVariants
        ? p.preferences.externalLists
        : p.preferences.externalLists.filter((l) => l.id !== listId),
      sortVariants: newVariants,
      catalogOrder: newOrder,
    });
  };

  const removeExternalWatchlist = (username: string) => {
    const catId = `letterboxd-watchlist-${username}`;
    const hasVariants = catalogHasVariants(catId);
    const { newOrder, newVariants } = stripCatalogAndVariants(catId, getCatalogOrder(), getSortVariants(), hasVariants);
    if (isPublic) {
      const p = props as PublicModeProps;
      if (!hasVariants) p.onRemovePublicExternalWatchlist(username);
      p.onPublicSortVariantsChange(newVariants);
      p.onPublicCatalogOrderChange(newOrder);
      return;
    }
    const p = props as FullModeProps;
    p.onPreferencesChange({
      ...p.preferences,
      externalWatchlists: hasVariants
        ? (p.preferences.externalWatchlists || [])
        : (p.preferences.externalWatchlists || []).filter((w) => w.username !== username),
      sortVariants: newVariants,
      catalogOrder: newOrder,
    });
  };

  const removeContributor = (id: string, kind: 'director' | 'actor' | 'studio') => {
    const catId = `letterboxd-contributor-${kind[0]}-${id}`;
    const { newOrder, newVariants } = stripCatalogAndVariants(catId, getCatalogOrder(), getSortVariants(), false);
    if (isPublic) {
      const p = props as PublicModeProps;
      p.onRemovePublicContributor(id, kind);
      p.onPublicSortVariantsChange(newVariants);
      p.onPublicCatalogOrderChange(newOrder);
    } else {
      const p = props as FullModeProps;
      const t = kind[0] as 'd' | 'a' | 's';
      p.onPreferencesChange({
        ...p.preferences,
        contributors: (p.preferences.contributors || []).filter((c) => !(c.t === t && c.id === id)),
        sortVariants: newVariants,
        catalogOrder: newOrder,
      });
    }
  };

  // ── Active items computation ──────────────────────────────────────────────

  const externalListsToShow = isPublic
    ? (props as PublicModeProps).publicLists
    : (props as FullModeProps).preferences.externalLists;

  const externalWatchlistsToShow = isPublic
    ? (props as PublicModeProps).publicExternalWatchlists
    : (props as FullModeProps).preferences.externalWatchlists || [];

  const selectedOwnListIds = isPublic
    ? (props as PublicModeProps).publicOwnLists
    : (props as FullModeProps).preferences.ownLists;

  // Base defs applicable to this mode
  const applicableBaseDefs = ALL_BASE_DEFS.filter((d) => {
    if (isPublic && (d.key === "diary" || d.key === "friends" || d.key === "recommended")) return false;
    if (isPublic && (d.key === "watchlist" || d.key === "likedFilms") && !hasUsername) return false;
    return true;
  });

  // Build ordered map of active items (insertion order = natural default order)
  const allActiveItemsMap = new Map<string, ActiveCatalogItem>();

  for (const def of applicableBaseDefs) {
    if (getCatalogEnabled(def.key)) {
      allActiveItemsMap.set(def.id, { id: def.id, type: "base", key: def.key, label: def.label, description: def.description });
    }
  }
  for (const listId of selectedOwnListIds) {
    const list = lists.find((l) => l.id === listId);
    if (list) {
      const catId = `letterboxd-list-${listId}`;
      allActiveItemsMap.set(catId, { id: catId, type: "ownList", listId, label: list.name, filmCount: list.filmCount });
    }
  }
  for (const ext of externalListsToShow) {
    const catId = `letterboxd-list-${ext.id}`;
    allActiveItemsMap.set(catId, { id: catId, type: "externalList", list: ext });
  }
  for (const w of externalWatchlistsToShow) {
    const catId = `letterboxd-watchlist-${w.username}`;
    allActiveItemsMap.set(catId, { id: catId, type: "externalWatchlist", watchlist: w });
  }
  const contributorsToShow = isPublic
    ? (props as PublicModeProps).publicContributors.map((c) => ({ t: c.kind[0] as 'd' | 'a' | 's', id: c.id, name: c.name, kind: c.kind }))
    : (props as FullModeProps).preferences.contributors?.map((c) => {
        const kind = c.t === 'd' ? 'director' : c.t === 'a' ? 'actor' : 'studio';
        return { t: c.t, id: c.id, name: c.name, kind: kind as 'director' | 'actor' | 'studio' };
      }) ?? [];
  for (const c of contributorsToShow) {
    const catId = `letterboxd-contributor-${c.t}-${c.id}`;
    allActiveItemsMap.set(catId, { id: catId, type: "contributor", contributor: { id: c.id, name: c.name, kind: c.kind } });
  }

  // Add variant items from sortVariants map
  const currentSortVariants = getSortVariants();
  for (const [baseCatalogId, keys] of Object.entries(currentSortVariants)) {
    for (const key of keys) {
      const opt = SORT_VARIANT_OPTIONS.find(o => o.key === key);
      if (!opt) continue;
      // Find a label for the base catalog
      const baseDef = applicableBaseDefs.find(d => d.id === baseCatalogId);
      const baseList = lists.find(l => `letterboxd-list-${l.id}` === baseCatalogId);
      const baseExtList = externalListsToShow.find(l => `letterboxd-list-${l.id}` === baseCatalogId);
      const baseExtWl = externalWatchlistsToShow.find(w => `letterboxd-watchlist-${w.username}` === baseCatalogId);
      let baseName = baseCatalogId;
      if (baseDef) baseName = getCatalogDisplayName(baseCatalogId, baseDef.label);
      else if (baseList) baseName = getCatalogDisplayName(baseCatalogId, baseList.name);
      else if (baseExtList) baseName = getCatalogDisplayName(baseCatalogId, baseExtList.name);
      else if (baseExtWl) baseName = getCatalogDisplayName(baseCatalogId, `${baseExtWl.displayName}'s Watchlist`);

      const variantId = `${baseCatalogId}--${key}`;
      allActiveItemsMap.set(variantId, {
        id: variantId,
        type: "variant",
        baseCatalogId,
        variantKey: key,
        label: `${baseName} (${opt.label})`,
      });
    }
  }

  // Sort by catalogOrder (items not in order go to end, preserving insertion order among them)
  const catalogOrder = getCatalogOrder();
  const sortedActiveItems: ActiveCatalogItem[] = [];
  const remaining = new Map(allActiveItemsMap);
  for (const id of catalogOrder) {
    const item = remaining.get(id);
    if (item) { sortedActiveItems.push(item); remaining.delete(id); }
  }
  for (const item of remaining.values()) {
    sortedActiveItems.push(item);
  }

  const effectiveCatalogOrder = sortedActiveItems.map((item) => item.id);
  const disabledBaseItems = applicableBaseDefs.filter((def) => !getCatalogEnabled(def.key));

  // ── DnD handler ───────────────────────────────────────────────────────────

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = effectiveCatalogOrder.indexOf(String(active.id));
    const newIndex = effectiveCatalogOrder.indexOf(String(over.id));
    if (oldIndex !== -1 && newIndex !== -1) {
      setCatalogOrder(arrayMove(effectiveCatalogOrder, oldIndex, newIndex));
    }
  };

  // ── Item rendering helpers ────────────────────────────────────────────────

  const getItemDisplayName = (item: ActiveCatalogItem): string => {
    switch (item.type) {
      case "base": return getCatalogDisplayName(item.id, item.label);
      case "ownList": return getCatalogDisplayName(item.id, item.label);
      case "externalList": return getCatalogDisplayName(item.id, item.list.name);
      case "externalWatchlist": {
        const def = `${item.watchlist.displayName}'s Watchlist`;
        return getCatalogDisplayName(item.id, def);
      }
      case "contributor":
        return getCatalogDisplayName(item.id, item.contributor.name);
      case "variant": return item.label;
    }
  };

  const getItemDefaultName = (item: ActiveCatalogItem): string => {
    switch (item.type) {
      case "base": return item.label;
      case "ownList": return item.label;
      case "externalList": return `${item.list.name} (${item.list.owner})`;
      case "externalWatchlist": return `${item.watchlist.displayName}'s Watchlist`;
      case "contributor": return item.contributor.name;
      case "variant": return item.label;
    }
  };

  const getItemSubtext = (item: ActiveCatalogItem): string => {
    switch (item.type) {
      case "base": return item.description;
      case "ownList": return `${item.filmCount} films`;
      case "externalList": return `by ${item.list.owner} · ${item.list.filmCount} films`;
      case "externalWatchlist": return `@${item.watchlist.username} · watchlist`;
      case "contributor":
        return item.contributor.kind.charAt(0).toUpperCase() + item.contributor.kind.slice(1);
      case "variant": {
        const opt = SORT_VARIANT_OPTIONS.find(o => o.key === item.variantKey);
        return opt?.description || "Sort variant";
      }
    }
  };

  const renderActiveItemAction = (item: ActiveCatalogItem) => {
    if (item.type === "base") {
      return <Toggle enabled={true} onToggle={() => toggleCatalog(item.key)} />;
    }
    const onRemove =
      item.type === "ownList" ? () => toggleOwnList(item.listId)
      : item.type === "externalList" ? () => removeExternalList(item.list.id)
      : item.type === "externalWatchlist" ? () => removeExternalWatchlist(item.watchlist.username)
      : item.type === "contributor" ? () => removeContributor(item.contributor.id, item.contributor.kind)
      : item.type === "variant" ? () => toggleCatalogVariant(item.baseCatalogId, item.variantKey)
      : undefined;
    if (!onRemove) return null;
    return (
      <button type="button" onClick={onRemove} className="flex-shrink-0 text-zinc-500 transition-colors hover:text-zinc-300">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={TRASH_PATH} />
        </svg>
      </button>
    );
  };

  return (
    <div className="fixed inset-0 flex h-screen w-screen items-center justify-center bg-[#0a0a0a] px-4 py-5 text-white sm:px-6">
      <div className="w-full max-w-3xl 2xl:max-w-4xl">
        <div className="film-grain animate-fade-in modal-scroll relative max-h-[88vh] overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-2xl sm:p-6 lg:p-7">
          {/* Header */}
          <div className="flex items-center justify-between gap-4">
            <button
              type="button"
              onClick={onBack}
              className="group inline-flex items-center gap-2 text-[12px] text-zinc-400 transition-colors hover:text-zinc-200"
            >
              <svg className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>

            <p className="text-[12px] text-zinc-500">
              {user ? (
                <span className="text-zinc-300">{user.displayName || user.username}</span>
              ) : (
                "Public mode"
              )}
            </p>
          </div>

          <CatalogsSection
            sortedActiveItems={sortedActiveItems}
            disabledBaseItems={disabledBaseItems}
            effectiveCatalogOrder={effectiveCatalogOrder}
            sensors={sensors}
            onDragEnd={handleDragEnd}
            editingCatalogId={editingCatalogId}
            editingName={editingName}
            onEditingNameChange={setEditingName}
            onStartEditingName={startEditingCatalogName}
            onSaveName={saveCatalogName}
            onCancelEditing={() => setEditingCatalogId(null)}
            expandedVariantCatalog={expandedVariantCatalog}
            onToggleVariantExpand={setExpandedVariantCatalog}
            availableVariantOptions={availableVariantOptions}
            canHaveVariants={canHaveVariants}
            getCatalogVariants={getCatalogVariants}
            getItemDisplayName={getItemDisplayName}
            getItemDefaultName={getItemDefaultName}
            getItemSubtext={getItemSubtext}
            renderActiveItemAction={renderActiveItemAction}
            onToggleCatalog={toggleCatalog}
            onToggleCatalogVariant={toggleCatalogVariant}
          />

          {isPublic ? (
            <DisplayOptionsSection
              mode="public"
              showRatings={(props as PublicModeProps).showRatings}
              onShowRatingsChange={(props as PublicModeProps).onShowRatingsChange}
              hideUnreleased={(props as PublicModeProps).hideUnreleased}
              onHideUnreleasedChange={(props as PublicModeProps).onHideUnreleasedChange}
              publicSearch={(props as PublicModeProps).publicSearch}
              onPublicSearchChange={(props as PublicModeProps).onPublicSearchChange}
            />
          ) : (
            <DisplayOptionsSection
              mode="full"
              preferences={(props as FullModeProps).preferences}
              onPreferencesChange={(props as FullModeProps).onPreferencesChange}
            />
          )}

          <ExternalCatalogsSection
            externalListUrl={externalListUrl}
            onExternalListUrlChange={onExternalListUrlChange}
            onAddExternalList={onAddExternalList}
            isResolvingList={isResolvingList}
          />

          {hasUsername && user && (
            <UserListsSection
              user={user}
              lists={lists}
              selectedListIds={selectedOwnListIds}
              editingCatalogId={editingCatalogId}
              editingName={editingName}
              onEditingNameChange={setEditingName}
              onStartEditingName={startEditingCatalogName}
              onSaveName={saveCatalogName}
              onCancelEditing={() => setEditingCatalogId(null)}
              getCatalogDisplayName={getCatalogDisplayName}
              isOwnListSelected={isOwnListSelected}
              onToggleOwnList={toggleOwnList}
              onSelectAll={selectAllOwnLists}
              onDeselectAll={deselectAllOwnLists}
            />
          )}

          {/* Save Button */}
          <div className="mt-8">
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 text-[15px] font-semibold text-black transition-all hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSaving ? (
                <>
                  <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  Saving...
                </>
              ) : (
                <>
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  {isPublic ? "Generate & Install" : "Save & Install"}
                </>
              )}
            </button>

            <p className="mt-4 text-center text-xs text-zinc-500">
              Enjoying Stremboxd?{" "}
              <a
                href="https://buymeacoffee.com/esp4ce"
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-400 underline underline-offset-2 transition-colors hover:text-zinc-200"
              >
                Buy me a coffee ☕
              </a>{" "}
              — it keeps the servers running.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
