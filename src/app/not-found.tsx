import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "./components/SiteHeader";
import Footer from "./components/Footer";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col items-center justify-center px-4 py-10 text-center sm:px-6 lg:px-8">
        <p className="font-mono text-[14px] text-dim">404</p>
        <h1 className="mt-3 text-[28px] font-medium leading-[1.08] tracking-[-0.035em] sm:text-[40px]">
          Page not found.
        </h1>
        <p className="mt-4 text-[18px] text-muted">★½. Didn&apos;t finish it.</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
          <Link href="/" className="btn btn-primary">
            Back to home
          </Link>
          <Link href="/#supporter" className="link-quiet py-2 text-[14px]">
            Support Stremboxd
          </Link>
        </div>
      </main>
      <Footer absolute={false} />
    </div>
  );
}
