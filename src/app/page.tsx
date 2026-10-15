import type { Metadata } from "next";
import HomeShell from "./HomeShell";
import { HOME_TITLE, SITE_DESCRIPTION, SITE_NAME, pageMetadata } from "../lib/seo";

export const metadata: Metadata = pageMetadata({
  title: `${HOME_TITLE} | ${SITE_NAME}`,
  description: SITE_DESCRIPTION,
  path: "/",
});

export default function Home() {
  return <HomeShell />;
}
