import Link from "next/link";
import TransitionLink from "./components/TransitionLink";
import Footer from "./components/Footer";

export default function NotFound() {
  return (
    <div className="fixed inset-0 flex h-[100dvh] w-screen flex-col items-center justify-center bg-background text-foreground">
      <div className="flex flex-col items-center gap-4 text-center">
        <TransitionLink href="/" direction="down" className="text-7xl font-semibold tracking-tight sm:text-9xl transition-opacity hover:opacity-70">
          404
        </TransitionLink>
        <p className="text-lg font-light text-muted sm:text-lg">
          ★½. Didn&apos;t finish it.
        </p>
        <Link
          href="/#supporter"
          className="mt-4 py-2 text-sm text-dim transition-colors hover:text-foreground"
        >
          Support Stremboxd
        </Link>
      </div>
      <Footer />
    </div>
  );
}
