import type { Metadata } from "next";
import HomeShell from "./HomeShell";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function Home() {
  return <HomeShell />;
}
