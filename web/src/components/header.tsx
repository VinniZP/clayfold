import { createContext, useContext, useEffect, type ReactNode } from "react";
import type { ClayName } from "./ui";

/** `focus` hides the app chrome around the page, leaving the title to screen readers. */
export type HeaderInfo = { title: string; sub?: string; back?: { to: string; label: string }; art?: ClayName; focus?: boolean };

const Ctx = createContext<(info: HeaderInfo) => void>(() => {});

export function HeaderProvider({ children, onChange }: { children: ReactNode; onChange: (info: HeaderInfo) => void }) {
  return <Ctx.Provider value={onChange}>{children}</Ctx.Provider>;
}

/** Sets the page heading shown by the layout and the document title. */
export function useHeader(info: HeaderInfo) {
  const set = useContext(Ctx);
  const key = JSON.stringify(info);
  useEffect(() => {
    const parsed = JSON.parse(key) as HeaderInfo;
    set(parsed);
    document.title = parsed.title ? `${parsed.title} · Clayfold` : "Clayfold";
  }, [key, set]);
}
