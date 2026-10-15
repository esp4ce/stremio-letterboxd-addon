import type { Metadata } from "next";
import { pageMetadata } from "../../lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Install Letterboxd Addon for Stremio & Nuvio | Stremboxd",
  description:
    "Connect your Letterboxd account, pick your catalogs and install the addon in Stremio or Nuvio. Username only or full access, with 2FA support.",
  path: "/configure",
});

export default function ConfigureLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
