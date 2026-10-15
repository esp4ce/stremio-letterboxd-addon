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
import { AccountLinkSection } from "./components/AccountLinkSection";
import SiteHeader from "../components/SiteHeader";
import Footer from "../components/Footer";
import { NativeSyncRow } from "./components/NativeSyncRow";

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
  /** Shows a supporter upsell notice */
  onUpsell: (message: string) => void;
}

interface FullModeProps extends BaseProps {
  mode: "full";
  preferences: UserPreferences;
  onPreferencesChange: (prefs: UserPreferences) => void;
  sortVariants: Record<string, string[]>;
  onSortVariantsChange: (variants: Record<string, string[]>) => void;
  isStremioLinked: boolean;
  onStremioLinkedChange: (linked: boolean) => void;
  isNuvioLinked: boolean;
  onNuvioLinkedChange: (linked: boolean) => void;
  entitled: boolean;
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
  hideNoHomeRelease: boolean;
  onHideNoHomeReleaseChange: (val: boolean) => void;
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

type ConfigSection = "catalogs" | "lists" | "display" | "accounts";

export default function ConfigurationModal(props: ConfigurationModalProps) {
  const { mode, user, lists, onBack, onSave, isSaving, externalListUrl, onExternalListUrlChange, onAddExternalList, isResolvingList } = props;

  const isPublic = mode === "public";
  const hasUsername = !!user;

  // Catalog name editing state
  const [section, setSection] = useState<ConfigSection>("catalogs");
  const [editingCatalogId, setEditingCatalogId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  // Sort variant expansion state
  const [expandedVariantCatalog, setExpandedVariantCatalog] = useState<string | null>(null);

  // DnD sensors: drag only activates from the grip handle
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

  const hideParentCatalog = (key: string) => {
    const catalogId = CATALOG_KEY_TO_ID[key]!;
    const { newOrder, newVariants } = stripCatalogAndVariants(catalogId, getCatalogOrder(), getSortVariants(), true);
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
    // Always strip the base catalog from the order; keep orphan variants when they exist
    // (backend resolves orphan variants via templateMap, so removing the base entry is safe).
    const { newOrder, newVariants } = stripCatalogAndVariants(catId, getCatalogOrder(), getSortVariants(), hasVariants);
    if (isPublic) {
      const p = props as PublicModeProps;
      p.onRemovePublicList(listId);
      p.onPublicSortVariantsChange(newVariants);
      p.onPublicCatalogOrderChange(newOrder);
      return;
    }
    const p = props as FullModeProps;
    p.onPreferencesChange({
      ...p.preferences,
      externalLists: p.preferences.externalLists.filter((l) => l.id !== listId),
      sortVariants: newVariants,
      catalogOrder: newOrder,
    });
  };

  const removeExternalWatchlist = (username: string) => {
    const catId = `letterboxd-watchlist-${username}`;
    const hasVariants = catalogHasVariants(catId);
    // Always strip the base catalog from the order; keep orphan variants when they exist.
    const { newOrder, newVariants } = stripCatalogAndVariants(catId, getCatalogOrder(), getSortVariants(), hasVariants);
    if (isPublic) {
      const p = props as PublicModeProps;
      p.onRemovePublicExternalWatchlist(username);
      p.onPublicSortVariantsChange(newVariants);
      p.onPublicCatalogOrderChange(newOrder);
      return;
    }
    const p = props as FullModeProps;
    p.onPreferencesChange({
      ...p.preferences,
      externalWatchlists: (p.preferences.externalWatchlists || []).filter((w) => w.username !== username),
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
      case "variant": return getCatalogDisplayName(item.id, item.label);
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
      const hasActiveVariants = catalogHasVariants(CATALOG_KEY_TO_ID[item.key]!);
      return (
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {hasActiveVariants && (
            <button
              type="button"
              onClick={() => hideParentCatalog(item.key)}
              title="Hide parent catalog, keep sort variants"
              className="rounded p-1 text-dim transition-colors hover:text-zinc-300"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
              </svg>
            </button>
          )}
          <Toggle enabled={true} onToggle={() => toggleCatalog(item.key)} />
        </div>
      );
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
      <button type="button" onClick={onRemove} className="flex-shrink-0 text-dim transition-colors hover:text-zinc-300">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={TRASH_PATH} />
        </svg>
      </button>
    );
  };

  const fullProps = props as FullModeProps;
  const publicProps = props as PublicModeProps;
  const isLinked = !isPublic && (fullProps.isStremioLinked || fullProps.isNuvioLinked);
  const saveLabel = isPublic ? "Generate & Install" : isLinked ? "Save" : "Save & Install";
  const activeCount = sortedActiveItems.length;

  const sections: { id: ConfigSection; label: string }[] = [
    { id: "catalogs", label: "Catalogs" },
    { id: "lists", label: "Lists" },
    { id: "display", label: "Display" },
    ...(!isPublic ? [{ id: "accounts" as const, label: "Accounts" }] : []),
  ];
  const current = sections.some((s) => s.id === section) ? section : "catalogs";

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground lg:h-dvh">
      <SiteHeader>
        <button
          type="button"
          onClick={onBack}
          className="rounded-control px-1 py-2 text-[13.5px] text-muted transition-colors hover:text-foreground"
        >
          Back
        </button>
        <span className="hidden max-w-[40vw] truncate text-[13.5px] text-dim sm:inline">
          {user ? user.displayName || user.username : "Public mode"}
        </span>
      </SiteHeader>

      <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-4 sm:px-6 lg:min-h-0">
        <div className="animate-fade-in grid flex-1 overflow-hidden rounded-card border border-line lg:min-h-0 lg:grid-cols-[190px_minmax(0,1fr)_280px]">
          <nav
            aria-label="Configuration sections"
            className="flex gap-1 overflow-x-auto border-b border-line p-2 lg:flex-col lg:overflow-visible lg:border-b-0 lg:border-r lg:p-3"
          >
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                aria-current={current === s.id ? "true" : undefined}
                className={`shrink-0 rounded-control px-3 py-2.5 text-left text-[14px] transition-colors ${
                  current === s.id ? "bg-raised text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className="panel-scroll min-w-0 p-4 sm:p-6 lg:overflow-y-auto">
            {current === "catalogs" && (
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
            )}

            {current === "display" &&
              (isPublic ? (
                <DisplayOptionsSection
                  mode="public"
                  showRatings={publicProps.showRatings}
                  onShowRatingsChange={publicProps.onShowRatingsChange}
                  hideUnreleased={publicProps.hideUnreleased}
                  onHideUnreleasedChange={publicProps.onHideUnreleasedChange}
                  hideNoHomeRelease={publicProps.hideNoHomeRelease}
                  onHideNoHomeReleaseChange={publicProps.onHideNoHomeReleaseChange}
                  publicSearch={publicProps.publicSearch}
                  onPublicSearchChange={publicProps.onPublicSearchChange}
                >
                  <NativeSyncRow preferences={null} signedIn={false} entitled={false} onBlocked={props.onUpsell} />
                </DisplayOptionsSection>
              ) : (
                <DisplayOptionsSection
                  mode="full"
                  preferences={fullProps.preferences}
                  onPreferencesChange={fullProps.onPreferencesChange}
                >
                  <NativeSyncRow
                    preferences={fullProps.preferences}
                    onPreferencesChange={fullProps.onPreferencesChange}
                    signedIn
                    entitled={fullProps.entitled}
                    onBlocked={props.onUpsell}
                  />
                </DisplayOptionsSection>
              ))}

            {current === "lists" && (
              <div className="space-y-8">
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
              </div>
            )}

            {current === "accounts" && !isPublic && (
              <AccountLinkSection
                stremioLinked={fullProps.isStremioLinked}
                onStremioLinkedChange={fullProps.onStremioLinkedChange}
                nuvioLinked={fullProps.isNuvioLinked}
                onNuvioLinkedChange={fullProps.onNuvioLinkedChange}
                entitled={fullProps.entitled}
              />
            )}
          </div>

          <aside className="sticky bottom-0 flex min-h-0 flex-col gap-4 border-t border-line bg-background p-4 lg:static lg:border-l lg:border-t-0 lg:bg-transparent lg:p-5">
            <div className="hidden min-h-0 flex-1 flex-col lg:flex">
              <p className="font-mono text-xs text-dim">Your addon</p>
              <dl className="mt-3 divide-y divide-line border-y border-line text-[13.5px]">
                <div className="flex justify-between py-2.5">
                  <dt className="text-muted">Catalogs</dt>
                  <dd className="tabular-nums">{activeCount} on</dd>
                </div>
                <div className="flex justify-between py-2.5">
                  <dt className="text-muted">Mode</dt>
                  <dd>{isPublic ? "Username only" : "Full access"}</dd>
                </div>
                <div className="flex justify-between py-2.5">
                  <dt className="text-muted">Player sync</dt>
                  <dd>{isPublic ? "Reinstall" : isLinked ? "Automatic" : "Not linked"}</dd>
                </div>
              </dl>
              <p className="mt-5 font-mono text-xs text-dim">In Stremio, in this order</p>
              <ol className="panel-scroll mt-2 min-h-0 flex-1 overflow-y-auto text-[13.5px]">
                {sortedActiveItems.map((item, index) => (
                  <li key={item.id} className="flex gap-3 border-b border-line py-2 text-muted">
                    <span className="w-5 shrink-0 text-right font-mono text-[11.5px] tabular-nums text-dim">{index + 1}</span>
                    <span className="min-w-0 truncate">{getItemDisplayName(item)}</span>
                  </li>
                ))}
              </ol>
            </div>
            <button type="button" onClick={onSave} disabled={isSaving} className="btn btn-primary w-full">
              {isSaving ? "Saving…" : saveLabel}
            </button>
          </aside>
        </div>
      </main>

      <Footer absolute={false} />
    </div>
  );
}
