"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  FileKey2,
  Landmark,
  LoaderCircle,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  lookupExplorer,
  type ExplorerLookupSuggestion,
} from "@/lib/explorer-api";
import { explorerRoutes } from "@/lib/explorer-routes";

type Props = {
  network: string;
  className?: string;
  compact?: boolean;
  autoFocus?: boolean;
};

function suggestionRoute(
  network: string,
  suggestion: ExplorerLookupSuggestion,
) {
  switch (suggestion.kind) {
    case "transaction":
      return explorerRoutes.tx(network, suggestion.value);
    case "account":
      return explorerRoutes.account(network, suggestion.value);
    case "contract":
      return explorerRoutes.contract(network, suggestion.value);
    case "ledger":
      return explorerRoutes.ledger(network, suggestion.value);
  }
}

function SuggestionIcon({ kind }: { kind: ExplorerLookupSuggestion["kind"] }) {
  if (kind === "transaction") return <FileKey2 />;
  if (kind === "ledger") return <Landmark />;
  return <UserRound />;
}

export function GlobalExplorerSearch({
  network,
  className = "",
  compact = false,
  autoFocus = false,
}: Props) {
  const router = useRouter();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<ExplorerLookupSuggestion[]>(
    [],
  );
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onShortcut);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onShortcut);
    };
  }, []);

  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) {
      setSuggestions([]);
      setLoading(false);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      setError(null);
      const result = await lookupExplorer(
        network,
        normalized,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setSuggestions(result.data?.suggestions ?? []);
      setActiveIndex(0);
      setError(result.error);
      setLoading(false);
      setOpen(true);
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [network, query]);

  const select = (suggestion: ExplorerLookupSuggestion) => {
    setOpen(false);
    router.push(suggestionRoute(network, suggestion));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" && suggestions.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % suggestions.length);
    }
    if (event.key === "ArrowUp" && suggestions.length) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(
        (index) => (index - 1 + suggestions.length) % suggestions.length,
      );
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const suggestion = suggestions[activeIndex];
      if (suggestion) select(suggestion);
      else setOpen(true);
    }
  };

  const showPanel = open && Boolean(query.trim());
  return (
    <div
      ref={rootRef}
      className={`global-explorer-search ${compact ? "is-compact" : ""} ${className}`}
    >
      <div className="global-explorer-search-input">
        {loading ? <LoaderCircle className="search-spinner" /> : <Search />}
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(Boolean(query.trim()))}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-label="Search transactions, accounts, contracts, or ledgers"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={showPanel}
          aria-activedescendant={
            suggestions[activeIndex] ? `${listId}-${activeIndex}` : undefined
          }
          placeholder="Search transaction hash, account, contract, or ledger"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
          >
            <X />
          </button>
        ) : (
          <kbd>Ctrl K</kbd>
        )}
      </div>
      {showPanel && (
        <div
          className="global-explorer-search-panel"
          id={listId}
          role="listbox"
        >
          {loading ? (
            <div className="global-search-state">Checking {network}...</div>
          ) : error ? (
            <div className="global-search-state is-error">{error}</div>
          ) : suggestions.length ? (
            suggestions.map((suggestion, index) => (
              <button
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "is-active" : ""}
                key={`${suggestion.kind}-${suggestion.value}`}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => select(suggestion)}
              >
                <span className="global-search-icon">
                  <SuggestionIcon kind={suggestion.kind} />
                </span>
                <span>
                  <strong>{suggestion.label}</strong>
                  <small>{suggestion.description}</small>
                </span>
                <code>
                  {suggestion.kind === "ledger"
                    ? `#${suggestion.value}`
                    : `${suggestion.value.slice(0, 10)}...${suggestion.value.slice(-6)}`}
                </code>
              </button>
            ))
          ) : (
            <div className="global-search-state">
              No matching record found on {network}. Check the value and
              network.
            </div>
          )}
        </div>
      )}
      <style jsx>{`
        .global-explorer-search {
          position: relative;
          width: 100%;
          z-index: 40;
        }
        .global-explorer-search-input {
          height: 48px;
          display: flex;
          align-items: center;
          gap: 11px;
          padding: 0 14px;
          border: 1px solid #4a423c;
          border-radius: 6px;
          background: #1d1918;
          color: #f2efec;
        }
        .is-compact .global-explorer-search-input {
          height: 38px;
        }
        .global-explorer-search-input :global(svg) {
          width: 16px;
          height: 16px;
          color: #817a76;
          flex: 0 0 auto;
        }
        .global-explorer-search-input input {
          width: 100%;
          min-width: 0;
          border: 0;
          outline: 0;
          background: transparent;
          color: inherit;
          font: inherit;
          font-size: 13px;
        }
        .global-explorer-search-input input::placeholder {
          color: #77706c;
        }
        .global-explorer-search-input button {
          display: grid;
          place-items: center;
          border: 0;
          background: transparent;
          padding: 4px;
          cursor: pointer;
        }
        .global-explorer-search-input kbd {
          font:
            600 10px ui-monospace,
            monospace;
          color: #918985;
          border: 1px solid #4a423c;
          border-radius: 4px;
          padding: 3px 6px;
          white-space: nowrap;
        }
        .search-spinner {
          animation: search-spin 0.8s linear infinite;
        }
        .global-explorer-search-panel {
          position: absolute;
          top: calc(100% + 7px);
          left: 0;
          right: 0;
          border: 1px solid #4a423c;
          border-radius: 6px;
          background: #262221;
          box-shadow: 0 14px 40px rgba(0, 0, 0, 0.4);
          overflow: hidden;
        }
        .global-explorer-search-panel > button {
          width: 100%;
          display: grid;
          grid-template-columns: 30px minmax(0, 1fr) auto;
          align-items: center;
          gap: 10px;
          padding: 11px 12px;
          border: 0;
          border-bottom: 1px solid #403936;
          background: transparent;
          color: #eeeae7;
          text-align: left;
          cursor: pointer;
        }
        .global-explorer-search-panel > button:last-child {
          border-bottom: 0;
        }
        .global-explorer-search-panel > button.is-active {
          background: #332e2b;
        }
        .global-search-icon {
          display: grid;
          place-items: center;
          width: 28px;
          height: 28px;
          border: 1px solid #4a423c;
          border-radius: 5px;
        }
        .global-search-icon :global(svg) {
          width: 14px;
          height: 14px;
          color: #a3ff5f;
        }
        .global-explorer-search-panel strong,
        .global-explorer-search-panel small {
          display: block;
        }
        .global-explorer-search-panel strong {
          font-size: 12px;
        }
        .global-explorer-search-panel small {
          margin-top: 3px;
          color: #958d88;
          font-size: 11px;
        }
        .global-explorer-search-panel code {
          max-width: 150px;
          overflow: hidden;
          text-overflow: ellipsis;
          color: #817a76;
          font-size: 10px;
        }
        .global-search-state {
          padding: 15px;
          color: #a59d98;
          font-size: 12px;
        }
        .global-search-state.is-error {
          color: #ff8d86;
        }
        @keyframes search-spin {
          to {
            transform: rotate(360deg);
          }
        }
        @media (max-width: 640px) {
          .global-explorer-search-panel code,
          .global-explorer-search-input kbd {
            display: none;
          }
          .global-explorer-search-panel > button {
            grid-template-columns: 30px minmax(0, 1fr);
          }
        }
      `}</style>
    </div>
  );
}
