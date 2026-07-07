"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FullCover } from "./context-view";

// ─── SettingsView ───────────────────────────────────────────────────────────

export interface SettingsViewProps {
  model: string;
  onModelChange: (m: string) => void;
  banned: string[];
  onAddPhrase: (phrase: string) => void;
  onRemovePhrase: (index: number) => void;
  onBack: () => void;
}

export function SettingsView({
  model,
  onModelChange,
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
      {/* Model picker */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Model</Label>
        <Select value={model} onValueChange={onModelChange}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">
              <div>
                <div>Auto</div>
                <div className="text-xs text-muted-foreground">
                  Haiku to generate, Sonnet to edit
                </div>
              </div>
            </SelectItem>
            <SelectItem value="claude-haiku-4-5">
              <div>
                <div>Haiku 4.5</div>
              </div>
            </SelectItem>
            <SelectItem value="claude-sonnet-4-5">
              <div>
                <div>Sonnet 4</div>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Banned phrases */}
      <div className="mt-6 space-y-3">
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
