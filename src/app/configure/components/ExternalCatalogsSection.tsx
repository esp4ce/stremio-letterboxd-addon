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
      <h3 className="text-[18px] font-medium text-foreground">
        External Catalogs
      </h3>
      <p className="mt-1 break-words text-[12px] text-dim">
        Lists, watchlists, or filmographies: letterboxd.com/user/list/... · /watchlist/ · /director/name/ · /actor/name/ · /studio/name/
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={externalListUrl}
          onChange={(e) => onExternalListUrlChange(e.target.value)}
          placeholder="letterboxd.com/user/list/name/ or /user/watchlist/"
          className="block w-full rounded-lg border border-line-strong bg-raised px-3 py-2.5 text-base text-foreground placeholder:text-dim sm:text-[14px] transition-colors focus:border-control focus:outline-none focus:ring-1 focus:ring-control"
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
          className="flex-shrink-0 rounded-lg border border-line-strong bg-raised px-4 py-2.5 text-[14px] text-foreground transition-colors hover:bg-line-strong disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isResolvingList ? "..." : "Add"}
        </button>
      </div>
    </div>
  );
}
