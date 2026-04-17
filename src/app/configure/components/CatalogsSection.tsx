"use client";

import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  type SensorDescriptor,
  type SensorOptions,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { EditableName, SortableCatalogRow, Toggle } from "./primitives";
import type { ActiveCatalogItem, BaseCatalogDef } from "./types";

interface CatalogsSectionProps {
  sortedActiveItems: ActiveCatalogItem[];
  disabledBaseItems: BaseCatalogDef[];
  effectiveCatalogOrder: string[];
  sensors: SensorDescriptor<SensorOptions>[];
  onDragEnd: (event: DragEndEvent) => void;

  // Edit state
  editingCatalogId: string | null;
  editingName: string;
  onEditingNameChange: (v: string) => void;
  onStartEditingName: (catalogId: string, currentName: string) => void;
  onSaveName: (catalogId: string, defaultName: string) => void;
  onCancelEditing: () => void;

  // Variant state
  expandedVariantCatalog: string | null;
  onToggleVariantExpand: (catalogId: string | null) => void;
  availableVariantOptions: Array<{ key: string; label: string; description: string }>;

  // Helpers
  canHaveVariants: (catalogId: string) => boolean;
  getCatalogVariants: (catalogId: string) => string[];
  getItemDisplayName: (item: ActiveCatalogItem) => string;
  getItemDefaultName: (item: ActiveCatalogItem) => string;
  getItemSubtext: (item: ActiveCatalogItem) => string;
  renderActiveItemAction: (item: ActiveCatalogItem) => React.ReactNode;

  // Handlers
  onToggleCatalog: (key: string) => void;
  onToggleCatalogVariant: (catalogId: string, variantKey: string) => void;
}

export function CatalogsSection({
  sortedActiveItems,
  disabledBaseItems,
  effectiveCatalogOrder,
  sensors,
  onDragEnd,
  editingCatalogId,
  editingName,
  onEditingNameChange,
  onStartEditingName,
  onSaveName,
  onCancelEditing,
  expandedVariantCatalog,
  onToggleVariantExpand,
  availableVariantOptions,
  canHaveVariants,
  getCatalogVariants,
  getItemDisplayName,
  getItemDefaultName,
  getItemSubtext,
  renderActiveItemAction,
  onToggleCatalog,
  onToggleCatalogVariant,
}: CatalogsSectionProps) {
  return (
    <div className="mt-7">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400">Catalogs</h3>
        {sortedActiveItems.length > 1 && (
          <p className="text-[10px] text-zinc-600">drag to reorder</p>
        )}
      </div>

      {sortedActiveItems.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={effectiveCatalogOrder} strategy={verticalListSortingStrategy}>
            <div className="mt-3 space-y-1.5">
              {sortedActiveItems.map((item) => {
                const isVariantItem = item.type === "variant";
                const variants = isVariantItem ? [] : getCatalogVariants(item.id);
                const hasVariants = !isVariantItem && canHaveVariants(item.id);
                const isExpanded = expandedVariantCatalog === item.id;

                return (
                  <div key={item.id}>
                    <SortableCatalogRow id={item.id}>
                      <div className="min-w-0 flex-1 pr-2">
                        <EditableName
                          catalogId={item.id}
                          displayName={getItemDisplayName(item)}
                          editingCatalogId={editingCatalogId}
                          editingName={editingName}
                          onEditingNameChange={onEditingNameChange}
                          onStartEditing={() => onStartEditingName(item.id, getItemDisplayName(item))}
                          onSave={() => onSaveName(item.id, getItemDefaultName(item))}
                          onCancel={onCancelEditing}
                        />
                        <div className="flex items-center gap-2">
                          <p className="text-[11px] text-zinc-500">{getItemSubtext(item)}</p>
                          {variants.length > 0 && (
                            <span className="text-[10px] text-zinc-600">
                              +{variants.length} sort{variants.length > 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      </div>
                      {hasVariants && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleVariantExpand(isExpanded ? null : item.id);
                          }}
                          className={`flex-shrink-0 rounded p-1 text-zinc-500 transition-colors hover:text-zinc-300 ${isExpanded ? "bg-zinc-700/50 text-zinc-300" : ""}`}
                          title="Sort variants"
                        >
                          <svg className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      )}
                      {renderActiveItemAction(item)}
                    </SortableCatalogRow>
                    {isExpanded && hasVariants && (
                      <div className="ml-6 mt-1 mb-1 flex flex-wrap gap-1.5 rounded-lg bg-zinc-800/20 px-3 py-2" onPointerDown={(e) => e.stopPropagation()}>
                        {availableVariantOptions.map((opt) => {
                          const active = variants.includes(opt.key);
                          return (
                            <button
                              key={opt.key}
                              type="button"
                              onClick={() => onToggleCatalogVariant(item.id, opt.key)}
                              className={`rounded-full border px-3 py-1 text-[11px] transition-colors ${active ? "border-white/30 bg-white/10 text-white" : "border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-300"}`}
                              title={opt.description}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                        <p className="w-full mt-1 text-[10px] text-zinc-600">Creates a separate catalog for each enabled option</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {disabledBaseItems.length > 0 && (
        <div className={`${sortedActiveItems.length > 0 ? "mt-1.5" : "mt-3"} space-y-1.5`}>
          {disabledBaseItems.map((def) => (
            <div
              key={def.key}
              className="flex items-center gap-2 rounded-lg bg-zinc-800/15 px-3 py-2.5 opacity-50"
            >
              <div className="w-4 flex-shrink-0" />
              <div className="min-w-0 flex-1 pr-2">
                <p className="truncate text-[13px] font-medium text-zinc-400">{def.label}</p>
                <p className="text-[11px] text-zinc-600">{def.description}</p>
              </div>
              <Toggle enabled={false} onToggle={() => onToggleCatalog(def.key)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
