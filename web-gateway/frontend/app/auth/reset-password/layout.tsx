import type { Metadata } from "next";

// The page is a client component, which cannot export metadata itself.
export const metadata: Metadata = {
  title: "Set a New Password | OpenGHM",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
