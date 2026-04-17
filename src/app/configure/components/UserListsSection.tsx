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
      <div className="mt-7">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400">Your Lists</h3>
        <p className="mt-3 text-[13px] text-zinc-500">No lists found on this account</p>
      </div>
    );
  }

  const ownListCount = selectedListIds.length;

  return (
    <div className="mt-7">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400">
          {user.displayName || user.username}&apos;s Lists
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-500">
            {ownListCount} / {lists.length}
          </span>
          <button
            type="button"
            onClick={onSelectAll}
            className="text-[11px] text-zinc-500 transition-colors hover:text-zinc-200"
          >
            All
          </button>
          <span className="text-[11px] text-zinc-700">/</span>
          <button
            type="button"
            onClick={onDeselectAll}
            className="text-[11px] text-zinc-500 transition-colors hover:text-zinc-200"
          >
            None
          </button>
        </div>
      </div>
      <div className="config-scroll mt-3 grid max-h-[20vh] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
        {lists.map((list) => {
          const ownCatId = `letterboxd-list-${list.id}`;
          return (
            <div
              key={list.id}
              className="flex cursor-pointer items-center gap-3 rounded-lg bg-zinc-800/35 px-3.5 py-2.5 transition-colors hover:bg-zinc-800/55"
            >
              <input
                type="checkbox"
                checked={isOwnListSelected(list.id)}
                onChange={() => onToggleOwnList(list.id)}
                className="h-4 w-4 rounded border-zinc-600 bg-zinc-700 text-white accent-white"
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
              <span className="flex-shrink-0 text-[11px] text-zinc-500">{list.filmCount}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
