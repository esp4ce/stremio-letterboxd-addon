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
    <div className="mt-7">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400">
        External Catalogs
      </h3>
      <p className="mt-1 text-[11px] text-zinc-500">
        Lists, watchlists, or filmographies — letterboxd.com/user/list/... · /watchlist/ · /director/name/ · /actor/name/ · /studio/name/
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={externalListUrl}
          onChange={(e) => onExternalListUrlChange(e.target.value)}
          placeholder="letterboxd.com/user/list/name/ or /user/watchlist/"
          className="block w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-[13px] text-white placeholder-zinc-500 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
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
          className="flex-shrink-0 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-[13px] text-zinc-300 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isResolvingList ? "..." : "Add"}
        </button>
      </div>
    </div>
  );
}
