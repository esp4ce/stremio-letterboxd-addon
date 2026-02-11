"use client";

interface UserPreferences {
  catalogs: { watchlist: boolean; diary: boolean; friends: boolean };
  ownLists: string[];
  externalLists: Array<{
    id: string;
    name: string;
    owner: string;
    filmCount: number;
  }>;
}

interface ConfigurationModalProps {
  user: { username: string; displayName: string | null };
  lists: Array<{ id: string; name: string; filmCount: number }>;
  preferences: UserPreferences;
  onPreferencesChange: (prefs: UserPreferences) => void;
  onSave: () => void;
  isSaving: boolean;
  externalListUrl: string;
  onExternalListUrlChange: (url: string) => void;
  onAddExternalList: () => void;
  isResolvingList: boolean;
  externalListError: string | null;
}

export default function ConfigurationModal({
  user,
  lists,
  preferences,
  onPreferencesChange,
  onSave,
  isSaving,
  externalListUrl,
  onExternalListUrlChange,
  onAddExternalList,
  isResolvingList,
  externalListError,
}: ConfigurationModalProps) {
  const toggleCatalog = (key: keyof UserPreferences["catalogs"]) => {
    onPreferencesChange({
      ...preferences,
      catalogs: {
        ...preferences.catalogs,
        [key]: !preferences.catalogs[key],
      },
    });
  };

  const toggleOwnList = (listId: string) => {
    const current = preferences.ownLists;
    const updated = current.includes(listId)
      ? current.filter((id) => id !== listId)
      : [...current, listId];
    onPreferencesChange({ ...preferences, ownLists: updated });
  };

  const removeExternalList = (listId: string) => {
    onPreferencesChange({
      ...preferences,
      externalLists: preferences.externalLists.filter((l) => l.id !== listId),
    });
  };

  const catalogItems: {
    key: keyof UserPreferences["catalogs"];
    label: string;
    description: string;
  }[] = [
    {
      key: "watchlist",
      label: "Watchlist",
      description: "Films you want to watch",
    },
    {
      key: "diary",
      label: "Diary",
      description: "Your recently watched films",
    },
    {
      key: "friends",
      label: "Friends Activity",
      description: "What your friends are watching",
    },
  ];

  return (
    <div className="fixed inset-0 flex h-screen w-screen items-center justify-center bg-[#0a0a0a] text-white">
      <div className="w-full max-w-lg px-8">
        <div className="film-grain animate-fade-in config-scroll relative max-h-[85vh] overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl lg:p-10">
          <h2 className="text-center text-2xl font-semibold text-white">
            Configure your addon
          </h2>
          <p className="mt-2 text-center text-sm text-zinc-400">
            Welcome, {user.displayName || user.username}!
          </p>

          {/* Catalogs Section */}
          <div className="mt-8">
            <h3 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
              Catalogs
            </h3>
            <div className="mt-3 space-y-2">
              {catalogItems.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-800/50 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-white">
                      {item.label}
                    </p>
                    <p className="text-xs text-zinc-500">{item.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleCatalog(item.key)}
                    className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
                      preferences.catalogs[item.key]
                        ? "bg-white"
                        : "bg-zinc-700"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full transition-transform ${
                        preferences.catalogs[item.key]
                          ? "translate-x-5 bg-black"
                          : "translate-x-0 bg-zinc-400"
                      }`}
                    />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Your Lists Section */}
          <div className="mt-8">
            <h3 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
              Your Lists
            </h3>
            <div className="mt-3 space-y-2">
              {lists.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  No lists on your account
                </p>
              ) : (
                lists.map((list) => (
                  <label
                    key={list.id}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-800/50 px-4 py-3"
                  >
                    <input
                      type="checkbox"
                      checked={preferences.ownLists.includes(list.id)}
                      onChange={() => toggleOwnList(list.id)}
                      className="h-4 w-4 rounded border-zinc-600 bg-zinc-700 text-white accent-white"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">
                        {list.name}
                      </p>
                    </div>
                    <span className="flex-shrink-0 text-xs text-zinc-500">
                      {list.filmCount} films
                    </span>
                  </label>
                ))
              )}
            </div>
          </div>

          {/* External Lists Section */}
          <div className="mt-8">
            <h3 className="text-sm font-medium uppercase tracking-wider text-zinc-400">
              External Lists
            </h3>
            <p className="mt-1 text-xs text-zinc-500">
              Import lists from other Letterboxd users by URL
            </p>

            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={externalListUrl}
                onChange={(e) => onExternalListUrlChange(e.target.value)}
                placeholder="letterboxd.com/user/list/name/"
                className="block w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-white placeholder-zinc-500 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500"
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
                className="flex-shrink-0 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isResolvingList ? "..." : "Add"}
              </button>
            </div>

            {externalListError && (
              <p className="mt-2 text-xs text-red-400">{externalListError}</p>
            )}

            {preferences.externalLists.length > 0 && (
              <div className="mt-3 space-y-2">
                {preferences.externalLists.map((list) => (
                  <div
                    key={list.id}
                    className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-800/50 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">
                        {list.name}
                      </p>
                      <p className="text-xs text-zinc-500">
                        by {list.owner} &middot; {list.filmCount} films
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeExternalList(list.id)}
                      className="flex-shrink-0 text-zinc-500 transition-colors hover:text-zinc-300"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Save Button */}
          <div className="mt-8">
            <button
              type="button"
              onClick={onSave}
              disabled={isSaving}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-white px-4 py-3.5 text-base font-semibold text-black transition-all hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isSaving ? (
                <>
                  <svg
                    className="h-5 w-5 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
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
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                    />
                  </svg>
                  Save &amp; Install
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
