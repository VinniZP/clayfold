import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, type ReactNode } from "react";
import { useTheme } from "../lib/theme";
import { bridge, darkTheme, lightTheme } from "../theme/themes";
import { bp, color, font } from "../theme/tokens.stylex";

const s = stylex.create({
  root: {
    minHeight: "100vh",
    padding: { default: 24, [bp.mobile]: 0 },
    backgroundColor: color.backdrop,
    color: color.text,
    fontFamily: font.body,
  },
});

/** Applies the chosen palette and the plain CSS variables that global CSS and figures read. */
export function AppRoot({ children }: { children: ReactNode }) {
  const theme = useTheme();
  // On <html>, so the page scrollbar and top-layer dialogs read the same tokens as the app.
  useLayoutEffect(() => {
    const classes = (stylex.props(theme === "dark" ? darkTheme : lightTheme, bridge.root).className ?? "").split(" ").filter(Boolean);
    const html = document.documentElement;
    html.classList.add(...classes);
    return () => html.classList.remove(...classes);
  }, [theme]);
  return (
    <div data-app-root="" {...stylex.props(s.root)}>
      {children}
    </div>
  );
}
