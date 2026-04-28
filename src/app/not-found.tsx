import TransitionLink from "./components/TransitionLink";
import Footer from "./components/Footer";

export default function NotFound() {
  return (
    <div className="fixed inset-0 flex h-[100dvh] w-screen flex-col items-center justify-center bg-[#0a0a0a] text-white">
      <div className="flex flex-col items-center gap-4 text-center">
        <TransitionLink href="/" direction="down" className="text-7xl font-semibold tracking-tight sm:text-9xl transition-opacity hover:opacity-70">
          404
        </TransitionLink>
        <p className="text-lg font-light text-zinc-400 sm:text-xl">
          ★½ — Didn&apos;t finish it.
        </p>
        <a
          href="https://buymeacoffee.com/esp4ce"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 text-sm font-light text-zinc-600 transition-colors hover:text-zinc-400"
        >
          buy me a coffee ☕
        </a>
      </div>
      <Footer />
    </div>
  );
}
