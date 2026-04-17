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
      className={`flex items-center gap-2 rounded-lg px-3 py-2.5 transition-colors ${isDragging ? "opacity-50 bg-zinc-800/60 shadow-lg" : "bg-zinc-800/35 hover:bg-zinc-800/50"}`}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        tabIndex={-1}
        className="flex-shrink-0 cursor-grab text-zinc-600 hover:text-zinc-400 active:cursor-grabbing touch-none"
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
        className="w-full rounded border border-zinc-600 bg-zinc-800 px-2 py-0.5 text-[13px] text-white focus:border-zinc-400 focus:outline-none"
      />
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <p className="truncate text-[13px] font-medium text-white">{displayName}</p>
      <button
        type="button"
        onClick={(e) => {
          if (stopPropagation) e.stopPropagation();
          onStartEditing();
        }}
        className="flex-shrink-0 text-zinc-600 transition-colors hover:text-zinc-300"
      >
        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={PENCIL_ICON} />
        </svg>
      </button>
    </div>
  );
}

export function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${enabled ? "bg-white" : "bg-zinc-700"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full transition-transform ${enabled ? "translate-x-5 bg-black" : "translate-x-0 bg-zinc-400"}`}
      />
    </button>
  );
}
