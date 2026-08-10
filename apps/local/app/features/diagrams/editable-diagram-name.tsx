import { useEffect, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";

export function EditableDiagramName({
  diagramId,
  name,
  className,
  inputClassName,
  onClickWhenIdle,
}: {
  diagramId: string;
  name: string;
  className?: string;
  inputClassName?: string;
  onClickWhenIdle?: (e: React.MouseEvent) => void;
}) {
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!editing) setDraft(name);
  }, [name, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data, revalidator]);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === name) {
      setDraft(name);
      setEditing(false);
      return;
    }
    fetcher.submit(
      { name: trimmed },
      { method: "post", action: `/api/diagrams/${diagramId}/update` }
    );
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setDraft(name);
            setEditing(false);
          }
        }}
        onClick={(e) => e.stopPropagation()}
        className={inputClassName ?? className}
      />
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        if (onClickWhenIdle) {
          onClickWhenIdle(e);
          if (e.defaultPrevented) return;
        }
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setEditing(true);
        }
      }}
      title="Click to rename"
      className={className}
    >
      {name}
    </span>
  );
}
