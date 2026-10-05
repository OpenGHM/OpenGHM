"use client";

import { createContext, useContext, useState } from "react";
import { SearchField } from "@/components/workspace/search-field";

interface SearchState {
  query: string;
  setQuery: (query: string) => void;
}

/** Without a provider (a table rendered on its own) nothing is searched. */
const SearchContext = createContext<SearchState>({ query: "", setQuery: () => {} });

/**
 * Holds what the list's search box says, for the table to read. The list's
 * toolbar (a server-rendered row of tabs, with the box beside it) and its table
 * are siblings, so the text lives here, above both; the tabs are links, so a
 * click on one keeps what was typed.
 */
export function DraftSearchProvider({ children }: { children: React.ReactNode }) {
  const [query, setQuery] = useState("");
  return <SearchContext.Provider value={{ query, setQuery }}>{children}</SearchContext.Provider>;
}

export function useDraftSearch(): SearchState {
  return useContext(SearchContext);
}

/** The list's search box: filters the loaded page by snapshot draft name. */
export function DraftSearchInput({ className }: { className?: string }) {
  const { query, setQuery } = useDraftSearch();
  return <SearchField value={query} onChange={setQuery} label="Search snapshot drafts by name" className={className} />;
}
