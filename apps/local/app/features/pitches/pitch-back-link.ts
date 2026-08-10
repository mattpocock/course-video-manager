export function pitchBackLink(from: string | null): {
  href: string;
  label: string;
} {
  if (from === "deliverables") {
    return { href: "/deliverables", label: "Back to Deliverables" };
  }
  return { href: "/pitches", label: "Back to Pitches" };
}
