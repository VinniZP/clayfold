import { useEffect } from "react";

// Lessons and topics the learner opened last, newest first, kept in this browser for the command palette.

export type RecentVisit = {
  kind: "lesson" | "topic";
  id: string;
  title: string;
  /** The lesson's course. */
  context: string | null;
  goal: boolean;
};

const KEY = "clayfold-recent";
const MAX = 6;

export function recentVisits(): RecentVisit[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((v): v is RecentVisit => typeof v?.id === "string" && typeof v?.title === "string" && (v.kind === "lesson" || v.kind === "topic")) : [];
  } catch {
    return [];
  }
}

/** Records the page's lesson or topic once its title is known. */
export function useRecentVisit(visit: RecentVisit | null): void {
  const key = visit ? JSON.stringify(visit) : null;
  useEffect(() => {
    if (!key) return;
    const next = JSON.parse(key) as RecentVisit;
    const list = [next, ...recentVisits().filter((v) => v.kind !== next.kind || v.id !== next.id)].slice(0, MAX);
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      // Storage may be unavailable (private mode); the palette then shows no recent items.
    }
  }, [key]);
}
