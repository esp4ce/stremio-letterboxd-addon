"use client";

import type { ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PENCIL_ICON } from "./constants";

export function GripIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="5" r="1.5" />
      <circle cx="15" cy="5" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="19" r="1.5" />
      <circle cx="15" cy="19" r="1.5" />
    </svg>
  );
}

export function SortableCatalogRow({ id, children }: { id: string; children: ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-lg px-3 py-2.5 transition-colors ${isDragging ? "opacity-50 bg-raised shadow-lg" : "bg-raised hover:bg-raised"}`}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        tabIndex={-1}
        className="flex-shrink-0 cursor-grab text-dim hover:text-muted active:cursor-grabbing touch-none"
        aria-label="Drag to reorder"
      >
        <GripIcon />
      </button>
      {children}
    </div>
  );
}

export function EditableName({
  catalogId,
  displayName,
  editingCatalogId,
  editingName,
  onEditingNameChange,
  onStartEditing,
  onSave,
  onCancel,
  stopPropagation,
}: {
  catalogId: string;
  displayName: string;
  editingCatalogId: string | null;
  editingName: string;
  onEditingNameChange: (v: string) => void;
  onStartEditing: () => void;
  onSave: () => void;
  onCancel: () => void;
  stopPropagation?: boolean;
}) {
  if (editingCatalogId === catalogId) {
    return (
      <input
        type="text"
        value={editingName}
        onChange={(e) => onEditingNameChange(e.target.value)}
        onBlur={onSave}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSave();
          if (e.key === "Escape") onCancel();
        }}
        autoFocus
        className="w-full rounded border border-control bg-raised px-2 py-0.5 text-base text-foreground focus:border-control focus:outline-none sm:text-[14px]"
      />
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <p className="min-w-0 break-words text-[14px] font-medium text-foreground sm:truncate">{displayName}</p>
      <button
        type="button"
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation();
          onStartEditing();
        }}
        className="flex-shrink-0 text-dim transition-colors hover:text-foreground"
      >
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={PENCIL_ICON} />
        </svg>
      </button>
    </div>
  );
}

export function Toggle({ enabled, onToggle, label }: { enabled: boolean; onToggle: () => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      onClick={onToggle}
      className={`relative h-6 w-11 flex-shrink-0 rounded-full border transition-colors ${
        enabled ? "border-foreground bg-foreground" : "border-control bg-raised"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full transition-transform ${enabled ? "translate-x-5 bg-background" : "translate-x-0 bg-dim"}`}
      />
    </button>
  );
}
