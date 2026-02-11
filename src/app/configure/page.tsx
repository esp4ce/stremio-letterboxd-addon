"use client";

import { useState, useRef } from "react";
import TransitionLink from "../components/TransitionLink";
import Footer from "../components/Footer";
import ConfigurationModal from "./ConfigurationModal";

const TOAST_DURATION = 3000;
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

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

interface LoginResponse {
  userToken: string;
  manifestUrl: string;
  user: {
    id: string;
    username: string;
    displayName: string | null;
  };
  lists: Array<{
    id: string;
    name: string;
    filmCount: number;
    description?: string;
  }>;
  preferences: UserPreferences | null;
}

interface LoginError {
  error: string;
  code?: string;
}

function getDefaultPreferences(
  lists: LoginResponse["lists"]
): UserPreferences {
  return {
    catalogs: { watchlist: true, diary: true, friends: true },
    ownLists: lists.map((l) => l.id),
    externalLists: [],
  };
}

export default function Configure() {
  const [isLoading, setIsLoading] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LoginResponse | null>(null);
  const [copied, setCopied] = useState(false);

  // Configuration state
  const [showConfig, setShowConfig] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);
  const [externalListUrl, setExternalListUrl] = useState("");
  const [isResolvingList, setIsResolvingList] = useState(false);
  const [externalListError, setExternalListError] = useState<string | null>(
    null
  );

  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    const username = usernameRef.current?.value?.trim();
    const password = passwordRef.current?.value;

    if (!username || !password) {
      setError("Please enter both username and password");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        const errorData = data as LoginError;
        throw new Error(errorData.error || "Authentication failed");
      }

      const loginResult = data as LoginResponse;
      setResult(loginResult);

      // Initialize preferences: use existing or create defaults
      const prefs =
        loginResult.preferences ??
        getDefaultPreferences(loginResult.lists);
      setPreferences(prefs);
      setShowConfig(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSavePreferences = async () => {
    if (!result || !preferences) return;

    setIsSavingPrefs(true);
    try {
      const response = await fetch(`${BACKEND_URL}/auth/preferences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userToken: result.userToken,
          preferences,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save preferences");
      }

      setShowConfig(false);
    } catch {
      setError("Failed to save preferences. Please try again.");
    } finally {
      setIsSavingPrefs(false);
    }
  };

  const handleResolveExternalList = async () => {
    if (!result || !externalListUrl.trim()) return;

    setIsResolvingList(true);
    setExternalListError(null);

    try {
      const response = await fetch(`${BACKEND_URL}/letterboxd/resolve-list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userToken: result.userToken,
          url: externalListUrl.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || "Failed to resolve list"
        );
      }

      const resolved = data as {
        id: string;
        name: string;
        owner: string;
        filmCount: number;
      };

      // Check for duplicates
      if (preferences?.externalLists.some((l) => l.id === resolved.id)) {
        setExternalListError("This list has already been added");
        return;
      }

      if (preferences) {
        setPreferences({
          ...preferences,
          externalLists: [...preferences.externalLists, resolved],
        });
      }

      setExternalListUrl("");
    } catch (err) {
      setExternalListError(
        err instanceof Error ? err.message : "Failed to resolve list"
      );
    } finally {
      setIsResolvingList(false);
    }
  };

  const handleCopy = async () => {
    if (result?.manifestUrl) {
      await navigator.clipboard.writeText(result.manifestUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleInstall = () => {
    if (result?.manifestUrl) {
      const stremioUrl = `stremio://${result.manifestUrl.replace(/^https?:\/\//, "")}`;
      window.location.href = stremioUrl;
    }
  };

  const handleTitleClick = () => {
    setShowToast(true);
    setTimeout(() => {
      setShowToast(false);
    }, TOAST_DURATION);
  };

  const handleReset = () => {
    setResult(null);
    setError(null);
    setShowConfig(false);
    setPreferences(null);
    if (passwordRef.current) {
      passwordRef.current.value = "";
    }
  };

  // Configuration modal
  if (result && showConfig && preferences) {
    return (
      <ConfigurationModal
        user={{
          username: result.user.username,
          displayName: result.user.displayName,
        }}
        lists={result.lists}
        preferences={preferences}
        onPreferencesChange={setPreferences}
        onSave={handleSavePreferences}
        isSaving={isSavingPrefs}
        externalListUrl={externalListUrl}
        onExternalListUrlChange={setExternalListUrl}
        onAddExternalList={handleResolveExternalList}
        isResolvingList={isResolvingList}
        externalListError={externalListError}
      />
    );
  }

  // Success screen
  if (result && !showConfig) {
    return (
      <div className="fixed inset-0 flex h-screen w-screen items-center justify-center bg-[#0a0a0a] text-white">
        <div className="w-full max-w-md px-8">
          <div className="film-grain animate-fade-in relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl lg:p-10">
            <div className="mb-6 flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
                <svg
                  className="h-8 w-8 text-green-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
            </div>

            <h2 className="text-center text-2xl font-semibold text-white">
              Addon Ready!
            </h2>

            <p className="mt-2 text-center text-sm text-zinc-400">
              Welcome, {result.user.displayName || result.user.username}!
            </p>

            <div className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-normal text-zinc-300">
                  Your Manifest URL
                </label>
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={result.manifestUrl}
                    className="block w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-300 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex-shrink-0 rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-zinc-300 transition-colors hover:bg-zinc-700"
                  >
                    {copied ? "✓" : "Copy"}
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={handleInstall}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-white px-4 py-3.5 text-base font-semibold text-black transition-all hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-zinc-900"
              >
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
                Install in Stremio
              </button>

              <button
                type="button"
                onClick={() => setShowConfig(true)}
                className="w-full text-center text-sm text-zinc-500 transition-colors hover:text-zinc-300"
              >
                Reconfigure catalogs
              </button>

              <button
                type="button"
                onClick={handleReset}
                className="w-full text-center text-sm text-zinc-500 transition-colors hover:text-zinc-300"
              >
                Connect a different account
              </button>
            </div>

            <div className="mt-6 border-t border-zinc-800 pt-5">
              <p className="text-center text-xs font-light leading-relaxed text-zinc-500">
                For the best experience, use{" "}
                <a
                  href="https://stremio-addon-manager.vercel.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-zinc-300 underline decoration-zinc-600 underline-offset-2 transition-colors hover:text-white hover:decoration-zinc-400"
                >
                  Stremio Addon Manager
                </a>{" "}
                to move this addon to the top of your list so Letterboxd info appears first.
              </p>
            </div>
          </div>
        </div>

        <Footer />
      </div>
    );
  }

  // Login form
  return (
    <div className="fixed inset-0 flex h-screen w-screen items-center justify-center bg-[#0a0a0a] text-white">
      <TransitionLink
        href="/"
        direction="down"
        className="absolute top-12 flex h-12 w-12 items-center justify-center rounded-full bg-white transition-all hover:scale-110 hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-[#0a0a0a]"
        ariaLabel="Back to home"
      >
        <svg
          className="h-6 w-6 text-black"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 10l7-7m0 0l7 7m-7-7v18"
          />
        </svg>
      </TransitionLink>

      <div className="w-full max-w-md px-8">
        <div className="film-grain animate-fade-in relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl lg:p-10">
          <h2
            onClick={handleTitleClick}
            className="cursor-pointer text-center text-2xl font-semibold text-white transition-colors hover:text-zinc-200"
          >
            Connect your account
          </h2>

          {error && (
            <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <form
            className="mt-8 space-y-6"
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-normal text-zinc-300"
              >
                Username
              </label>
              <input
                ref={usernameRef}
                type="text"
                id="username"
                name="username"
                autoComplete="username"
                placeholder="your-username"
                disabled={isLoading}
                className="mt-2 block w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-white placeholder-zinc-500 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-normal text-zinc-300"
              >
                Password
              </label>
              <input
                ref={passwordRef}
                type="password"
                id="password"
                name="password"
                autoComplete="current-password"
                placeholder="•••••••••••••"
                disabled={isLoading}
                className="mt-2 block w-full rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-3 text-white placeholder-zinc-500 transition-colors focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-white px-4 py-3.5 text-base font-semibold text-black transition-all hover:bg-zinc-200 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-zinc-900 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isLoading ? (
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
                  Connecting...
                </>
              ) : (
                "Generate my addon"
              )}
            </button>

            <p className="cursor-default text-center text-xs text-zinc-500">
              Your credentials are used to authenticate with Letterboxd. Only
              your encrypted refresh token is stored.
            </p>
          </form>
        </div>
      </div>

      <Footer />

      {showToast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 animate-fade-in rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3 text-sm font-light text-zinc-300 shadow-2xl">
          Enter your Letterboxd credentials below to sync your collection
        </div>
      )}
    </div>
  );
}
