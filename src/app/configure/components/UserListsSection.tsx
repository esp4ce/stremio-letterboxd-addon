"use client";

import { EditableName } from "./primitives";

interface UserListsSectionProps {
  user: { username: string; displayName: string | null };
  lists: Array<{ id: string; name: string; filmCount: number }>;
  selectedListIds: string[];
  editingCatalogId: string | null;
  editingName: string;
  onEditingNameChange: (v: string) => void;
  onStartEditingName: (catalogId: string, currentName: string) => void;
  onSaveName: (catalogId: string, defaultName: string) => void;
  onCancelEditing: () => void;
  getCatalogDisplayName: (catalogId: string, defaultName: string) => string;
  isOwnListSelected: (listId: string) => boolean;
  onToggleOwnList: (listId: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
}

export function UserListsSection({
  user,
  lists,
  selectedListIds,
  editingCatalogId,
  editingName,
  onEditingNameChange,
  onStartEditingName,
  onSaveName,
  onCancelEditing,
  getCatalogDisplayName,
  isOwnListSelected,
  onToggleOwnList,
  onSelectAll,
  onDeselectAll,
}: UserListsSectionProps) {
  if (lists.length === 0) {
    return (
      <div>
        <h3 className="text-[18px] font-medium text-foreground">Your Lists</h3>
        <p className="mt-3 text-[14px] text-dim">No lists found on this account</p>
      </div>
    );
  }

  const ownListCount = selectedListIds.length;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-[14px] text-dim">
          {ownListCount} of {lists.length} selected
        </p>
        <div className="flex flex-shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onSelectAll}
            className="rounded-control px-2 py-1.5 text-[14px] text-muted transition-colors hover:text-foreground"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={onDeselectAll}
            className="rounded-control px-2 py-1.5 text-[14px] text-muted transition-colors hover:text-foreground"
          >
            None
          </button>
        </div>
      </div>
      <div className="config-scroll mt-3 grid max-h-[40dvh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
        {lists.map((list) => {
          const ownCatId = `letterboxd-list-${list.id}`;
          return (
            <div
              key={list.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg bg-raised px-3.5 py-2.5 transition-colors hover:bg-raised"
            >
              <input
                type="checkbox"
                checked={isOwnListSelected(list.id)}
                onChange={() => onToggleOwnList(list.id)}
                className="h-4 w-4 rounded border-control bg-line-strong text-foreground accent-white"
              />
              <div className="min-w-0 flex-1">
                <EditableName
                  catalogId={ownCatId}
                  displayName={getCatalogDisplayName(ownCatId, list.name)}
                  editingCatalogId={editingCatalogId}
                  editingName={editingName}
                  onEditingNameChange={onEditingNameChange}
                  onStartEditing={() => onStartEditingName(ownCatId, getCatalogDisplayName(ownCatId, list.name))}
                  onSave={() => onSaveName(ownCatId, list.name)}
                  onCancel={onCancelEditing}
                  stopPropagation
                />
              </div>
              <span className="flex-shrink-0 text-[12px] text-dim">{list.filmCount}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
