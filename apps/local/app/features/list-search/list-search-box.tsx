import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { searchQueryOf, withSearchQuery } from "./list-search";

/**
 * The in-page search box (#2512). Uncontrolled: it starts from `?q=` and each
 * keystroke replaces the URL entry, so the URL is the only state. When the
 * URL's query changes from elsewhere ("Clear all", Back), the box follows it.
 */
export function ListSearchBox({ placeholder }: { placeholder: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchQueryOf(searchParams);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (input && input.value !== query) input.value = query;
  }, [query]);

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
      <Input
        ref={inputRef}
        type="search"
        aria-label="Search"
        placeholder={placeholder}
        defaultValue={query}
        className="pl-9"
        onChange={(e) => {
          const value = e.currentTarget.value;
          setSearchParams((params) => withSearchQuery(params, value), {
            replace: true,
            preventScrollReset: true,
          });
        }}
      />
    </div>
  );
}
