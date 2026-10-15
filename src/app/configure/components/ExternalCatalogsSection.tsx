"use client";

interface ExternalCatalogsSectionProps {
  externalListUrl: string;
  onExternalListUrlChange: (url: string) => void;
  onAddExternalList: () => void;
  isResolvingList: boolean;
}

export function ExternalCatalogsSection({
  externalListUrl,
  onExternalListUrlChange,
  onAddExternalList,
  isResolvingList,
}: ExternalCatalogsSectionProps) {
  return (
    <div>
      <label htmlFor="external-list-url" className="text-[18px] font-medium text-foreground">
        Add a list, watchlist or person
      </label>
      <p className="mt-1 text-[14px] text-dim">
        Paste a Letterboxd link to a list, a watchlist, or a director, actor or studio page.
      </p>

      <div className="mt-3 flex gap-2">
        <input
          id="external-list-url"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          value={externalListUrl}
          onChange={(e) => onExternalListUrlChange(e.target.value)}
          placeholder="https://letterboxd.com/…"
          className="field-input min-w-0"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAddExternalList();
            }
          }}
        />
        <button
          type="button"
          onClick={onAddExternalList}
          disabled={isResolvingList || !externalListUrl.trim()}
          className="btn btn-ghost h-11 shrink-0 px-5"
        >
          {isResolvingList ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  );
}
