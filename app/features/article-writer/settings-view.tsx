"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FullCover } from "./context-view";

// ─── SettingsView ───────────────────────────────────────────────────────────

export interface SettingsViewProps {
  banned: string[];
  onAddPhrase: (phrase: string) => void;
  onRemovePhrase: (index: number) => void;
  onBack: () => void;
}

export function SettingsView({
  banned,
  onAddPhrase,
  onRemovePhrase,
  onBack,
}: SettingsViewProps) {
  const [newPhrase, setNewPhrase] = useState("");

  const addPhrase = () => {
    const phrase = newPhrase.trim();
    if (phrase && !banned.includes(phrase)) {
      onAddPhrase(phrase);
      setNewPhrase("");
    }
  };

  const removePhrase = (index: number) => {
    onRemovePhrase(index);
  };

  return (
    <FullCover title="Settings" onBack={onBack}>
      {/* Banned phrases */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Banned phrases</Label>

        {banned.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {banned.map((phrase, i) => (
              <span
                key={`${phrase}-${i}`}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs"
              >
                {phrase}
                <button
                  onClick={() => removePhrase(i)}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Input
            value={newPhrase}
            onChange={(e) => setNewPhrase(e.target.value)}
            placeholder="Add a banned phrase..."
            className="text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addPhrase();
              }
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={addPhrase}
            disabled={!newPhrase.trim()}
          >
            Add
          </Button>
        </div>
      </div>
    </FullCover>
  );
}
