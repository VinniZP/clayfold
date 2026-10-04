import * as stylex from "@stylexjs/stylex";
import { Search } from "lucide-react";
import { useId, useState } from "react";
import { Link } from "react-router";
import type { GlossaryEntry } from "@shared/api";
import { useHeader } from "../components/header";
import { Empty, ErrorBox, PageLoading } from "../components/ui";
import { api } from "../lib/api";
import { t, useLang } from "../lib/i18n";
import { useResource } from "../lib/useResource";
import { bp, color, font, radius, reading } from "../theme/tokens.stylex";
import { card, field, layout, readable, text } from "../theme/ui";

const s = stylex.create({
  page: { display: "grid", gap: 24 },
  filters: { display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" },
  searchWrap: { position: "relative", flexGrow: 1, flexBasis: 280, minWidth: 0 },
  searchIcon: { position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", color: color.textMuted, pointerEvents: "none" },
  search: { paddingLeft: 44 },
  course: { flexBasis: 260, flexGrow: { default: 0, [bp.mobile]: 1 }, width: "auto" },
  count: { fontSize: 14, color: color.textMuted },
  groups: { display: "grid", gap: 28 },
  group: { display: "grid", gap: 12 },
  groupTitle: { fontFamily: font.display, fontSize: 22, fontWeight: 800, letterSpacing: "-0.01em" },
  list: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: 12, margin: 0, padding: 0, listStyle: "none" },
  term: { display: "grid", gap: 6, alignContent: "start", paddingBlock: 16, paddingInline: 18, borderRadius: radius.inner, backgroundColor: color.surface2 },
  termHead: { display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 8, rowGap: 2 },
  name: { fontSize: `calc(17px * ${reading.scale})`, fontWeight: 750 },
  meta: { fontSize: 13, color: color.textMuted },
});

function groupByCourse(entries: GlossaryEntry[]) {
  const groups = new Map<string, { title: string; entries: GlossaryEntry[] }>();
  for (const e of entries) {
    const g = groups.get(e.topicId) ?? { title: e.topicTitle, entries: [] };
    g.entries.push(e);
    groups.set(e.topicId, g);
  }
  return [...groups.entries()].sort(([, a], [, b]) => a.title.localeCompare(b.title));
}

export function GlossaryPage() {
  useLang();
  useHeader({ title: t("glossary.title"), sub: t("glossary.sub") });
  const res = useResource(api.glossary, "glossary");
  const [query, setQuery] = useState("");
  const [course, setCourse] = useState("");
  const searchId = useId();
  const courseId = useId();

  if (res.loading && !res.data) return <PageLoading />;
  if (res.error && !res.data)
    return (
      <section {...stylex.props(card.base)}>
        <ErrorBox error={res.error} onRetry={res.reload} />
      </section>
    );
  const all = res.data ?? [];
  const q = query.trim().toLowerCase();
  const shown = all.filter(
    (e) =>
      (!course || e.topicId === course) &&
      (!q || [e.term, e.original ?? "", e.definition].some((f) => f.toLowerCase().includes(q))),
  );
  const courses = groupByCourse(all).map(([id, g]) => ({ id, title: g.title }));

  return (
    <div {...stylex.props(s.page)}>
      <section {...stylex.props(card.base)}>
        {all.length === 0 ? (
          <Empty title={t("glossary.emptyTitle")}>{t("glossary.emptyBody")}</Empty>
        ) : (
          <div {...stylex.props(s.groups)}>
            <div {...stylex.props(s.filters)}>
              <div {...stylex.props(s.searchWrap)}>
                <label htmlFor={searchId} {...stylex.props(layout.srOnly)}>
                  {t("glossary.search")}
                </label>
                <Search size={18} aria-hidden="true" {...stylex.props(s.searchIcon)} />
                <input id={searchId} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("glossary.search")} {...stylex.props(field.input, s.search)} />
              </div>
              <label htmlFor={courseId} {...stylex.props(layout.srOnly)}>
                {t("glossary.course")}
              </label>
              <select id={courseId} value={course} onChange={(e) => setCourse(e.target.value)} {...stylex.props(field.input, field.select, s.course)}>
                <option value="">{t("glossary.allCourses")}</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <span role="status" {...stylex.props(s.count)}>
                {t("glossary.count", { count: shown.length })}
              </span>
            </div>
            {shown.length === 0 ? (
              <Empty title={t("glossary.noMatch")} />
            ) : (
              groupByCourse(shown).map(([topicId, g]) => (
                <section key={topicId} aria-labelledby={`glossary-${topicId}`} {...stylex.props(s.group)}>
                  <h2 id={`glossary-${topicId}`} {...stylex.props(s.groupTitle)}>
                    <Link to={`/topics/${topicId}`} {...stylex.props(text.link)}>
                      {g.title}
                    </Link>
                  </h2>
                  <ul {...stylex.props(s.list, readable.surface)}>
                    {g.entries.map((e) => (
                      <li key={e.term} {...stylex.props(s.term)}>
                        <div {...stylex.props(s.termHead)}>
                          <span {...stylex.props(s.name)}>{e.term}</span>
                          {e.original && <span {...stylex.props(s.meta)}>{e.original}</span>}
                        </div>
                        <p>{e.definition}</p>
                        {e.avoid.length > 0 && <p {...stylex.props(s.meta)}>{t("glossary.avoid", { words: e.avoid.join(", ") })}</p>}
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        )}
      </section>
    </div>
  );
}
