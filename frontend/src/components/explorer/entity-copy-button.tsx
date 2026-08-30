"use client";

import { Check, Copy } from "lucide-react";
import type { MouseEvent } from "react";
import { useState } from "react";

export function EntityCopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      className="explorer-entity-copy"
      data-copied={copied ? "true" : "false"}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={copied ? "Copied" : `Copy ${label}`}
      onClick={(event) => void copy(event)}
    >
      {copied ? <Check size={8} strokeWidth={3} /> : <Copy size={10} />}
    </button>
  );
}
