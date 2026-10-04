import * as stylex from "@stylexjs/stylex";
import {
  ArrowLeftRight,
  AudioLines,
  BookOpen,
  Check,
  Clapperboard,
  ClipboardCheck,
  Crown,
  Download,
  FileText,
  FileUp,
  Headphones,
  Keyboard,
  Library,
  Lightbulb,
  ListChecks,
  MessagesSquare,
  NotebookPen,
  PawPrint,
  PenLine,
  PlayCircle,
  RotateCcw,
  Search,
  Sparkles,
  TextSelect,
  X,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { INTRO_FEATURES, INTRO_RELEASED, type IntroFeature, type Settings, type SettingsUpdate } from "@shared/api";
import type { MessageKey } from "@shared/i18n";
import { api, errorText } from "../lib/api";
import { dateFormat } from "../lib/format";
import { setGameOn, useCelebrationHold } from "../lib/game";
import { t, useLang } from "../lib/i18n";
import { bp, color, font, radius } from "../theme/tokens.stylex";
import { btn, chip, field, text } from "../theme/ui";
import { Meerkat } from "./meerkat/Meerkat";
import { Spinner } from "./ui";

type Flow = { icon: LucideIcon; title: MessageKey; body: MessageKey }[];

const FLOWS: Record<IntroFeature, Flow> = {
  game: [
    { icon: BookOpen, title: "intro.game.how1", body: "intro.game.how1Body" },
    { icon: Sparkles, title: "intro.game.how2", body: "intro.game.how2Body" },
    { icon: Crown, title: "intro.game.how3", body: "intro.game.how3Body" },
    { icon: PawPrint, title: "intro.game.how4", body: "intro.game.how4Body" },
  ],
  video: [
    { icon: FileText, title: "intro.video.how1", body: "intro.video.how1Body" },
    { icon: PenLine, title: "intro.video.how2", body: "intro.video.how2Body" },
    { icon: AudioLines, title: "intro.video.how3", body: "intro.video.how3Body" },
    { icon: PlayCircle, title: "intro.video.how4", body: "intro.video.how4Body" },
  ],
  practice: [
    { icon: ArrowLeftRight, title: "intro.practice.how1", body: "intro.practice.how1Body" },
    { icon: ClipboardCheck, title: "intro.practice.how2", body: "intro.practice.how2Body" },
    { icon: Sparkles, title: "intro.practice.how3", body: "intro.practice.how3Body" },
    { icon: NotebookPen, title: "intro.practice.how4", body: "intro.practice.how4Body" },
  ],
  lessons: [
    { icon: Lightbulb, title: "intro.lessons.how1", body: "intro.lessons.how1Body" },
    { icon: TextSelect, title: "intro.lessons.how2", body: "intro.lessons.how2Body" },
    { icon: FileUp, title: "intro.lessons.how3", body: "intro.lessons.how3Body" },
    { icon: Headphones, title: "intro.lessons.how4", body: "intro.lessons.how4Body" },
  ],
  comfort: [
    { icon: Search, title: "intro.comfort.how1", body: "intro.comfort.how1Body" },
    { icon: Keyboard, title: "intro.comfort.how2", body: "intro.comfort.how2Body" },
    { icon: BookOpen, title: "intro.comfort.how3", body: "intro.comfort.how3Body" },
    { icon: Download, title: "intro.comfort.how4", body: "intro.comfort.how4Body" },
  ],
  teachback: [
    { icon: BookOpen, title: "intro.teachback.how1", body: "intro.teachback.how1Body" },
    { icon: MessagesSquare, title: "intro.teachback.how2", body: "intro.teachback.how2Body" },
    { icon: ListChecks, title: "intro.teachback.how3", body: "intro.teachback.how3Body" },
    { icon: RotateCcw, title: "intro.teachback.how4", body: "intro.teachback.how4Body" },
  ],
  sources: [
    { icon: Search, title: "intro.sources.how1", body: "intro.sources.how1Body" },
    { icon: ListChecks, title: "intro.sources.how2", body: "intro.sources.how2Body" },
    { icon: FileText, title: "intro.sources.how3", body: "intro.sources.how3Body" },
    { icon: RotateCcw, title: "intro.sources.how4", body: "intro.sources.how4Body" },
  ],
};

/** Optional features: their entry offers to turn them on. The other entries show what arrived and only move on. */
const TOGGLES: Partial<Record<IntroFeature, { on: (s: Settings) => boolean; update: SettingsUpdate; label: MessageKey }>> = {
  video: { on: (s) => s.video.enabled, update: { videoEnabled: true }, label: "intro.video.on" },
  game: { on: (s) => s.gamification, update: { gamification: true }, label: "intro.game.on" },
  teachback: { on: (s) => s.teachback.enabled, update: { teachbackEnabled: true }, label: "intro.teachback.on" },
};

const ART: Record<Exclude<IntroFeature, "game">, { icon: LucideIcon; bg: string; ink: string }> = {
  video: { icon: Clapperboard, bg: "linear-gradient(160deg, #E7E5FB, #CBC9F5)", ink: "#5640AE" },
  practice: { icon: ClipboardCheck, bg: "linear-gradient(160deg, #ECF3D5, #D9E9AD)", ink: "#4A7419" },
  lessons: { icon: Lightbulb, bg: "linear-gradient(160deg, #FFE0D3, #FFC9B4)", ink: "#A23F22" },
  comfort: { icon: Keyboard, bg: "linear-gradient(160deg, #FBE6C4, #F2D29B)", ink: "#865000" },
  teachback: { icon: MessagesSquare, bg: "linear-gradient(160deg, #E7E5FB, #FBE6C4)", ink: "#5640AE" },
  sources: { icon: Library, bg: "linear-gradient(160deg, #ECF3D5, #E7E5FB)", ink: "#4A7419" },
};

const KEY_FORMS = {
  video: { label: "intro.video.key", hint: "settings.keyHint", save: (key: string) => api.setElevenLabsKey(key) },
  sources: { label: "intro.sources.key", hint: "settings.exaKeyHint", save: (key: string) => api.setExaKey(key) },
} satisfies Record<string, { label: MessageKey; hint: MessageKey; save: (key: string) => Promise<Settings> }>;

const TONES = [
  { bg: "#E7E5FB", ink: "#5640AE" },
  { bg: "#FFE0D3", ink: "#A23F22" },
  { bg: "#ECF3D5", ink: "#4A7419" },
  { bg: "#FBE6C4", ink: "#865000" },
];

const s = stylex.create({
  dialog: {
    width: "min(820px, calc(100vw - 32px))",
    maxHeight: "calc(100dvh - 32px)",
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.frame,
    backgroundColor: color.surface,
    color: color.text,
    "::backdrop": { backgroundColor: "rgb(30 20 40 / 0.55)", backdropFilter: "blur(4px)" },
  },
  inner: { position: "relative", display: "grid", gap: 20, paddingBlock: 28, paddingInline: { default: 32, [bp.phone]: 18 } },
  top: { display: "flex", alignItems: "center", gap: 12 },
  kicker: { fontSize: 13, fontWeight: 750, letterSpacing: "0.06em", textTransform: "uppercase", color: color.accentText },
  dots: { display: "flex", gap: 6, marginLeft: "auto" },
  dot: { width: 8, height: 8, borderRadius: "50%", backgroundColor: color.surface3 },
  dotOn: { width: 22, borderRadius: radius.pill, backgroundColor: color.primary },
  close: { marginLeft: 8 },
  closeAlone: { marginLeft: "auto" },
  flowList: { listStyle: "none", marginTop: 10, marginBottom: 0, marginInline: 0, padding: 0 },
  hero: { display: "grid", gridTemplateColumns: { default: "130px minmax(0, 1fr)", [bp.phone]: "minmax(0, 1fr)" }, gap: 20, alignItems: "center" },
  heroArt: { display: "grid", placeItems: "center", width: 130, height: 130, borderRadius: 32 },
  title: { fontFamily: font.display, fontSize: { default: 30, [bp.phone]: 24 }, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.1 },
  why: { marginTop: 8, fontSize: 15.5, lineHeight: 1.5 },
  label: { fontSize: 12.5, fontWeight: 750, letterSpacing: "0.06em", textTransform: "uppercase", color: color.textMuted },
  flow: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 1fr) 18px minmax(0, 1fr) 18px minmax(0, 1fr) 18px minmax(0, 1fr)", [bp.mobile]: "minmax(0, 1fr)" },
    gap: 6,
    alignItems: "stretch",
  },
  stepCard: { display: "grid", alignContent: "start", gap: 8, padding: 14, borderRadius: radius.inner },
  stepTop: { display: "flex", alignItems: "center", gap: 8 },
  stepNum: { display: "grid", placeItems: "center", width: 22, height: 22, borderRadius: "50%", fontSize: 12, fontWeight: 800, color: "#FFF9F3" },
  stepTitle: { fontWeight: 750, fontSize: 14, lineHeight: 1.25, color: "#32253F" },
  stepBody: { fontSize: 12.5, lineHeight: 1.4, color: "#32253F", opacity: 0.8 },
  arrow: { alignSelf: "center", justifySelf: "center", width: 0, height: 0, borderTopWidth: 7, borderBottomWidth: 7, borderLeftWidth: 9, borderStyle: "solid", borderColor: "transparent", borderLeftColor: color.borderStrong, display: { default: "block", [bp.mobile]: "none" } },
  plan: { display: "flex", alignItems: "flex-start", gap: 10, paddingBlock: 12, paddingInline: 14, borderRadius: radius.inner, backgroundColor: color.surface2, fontSize: 13.5, lineHeight: 1.45 },
  planIcon: { flexShrink: 0, marginTop: 1, color: color.accentText },
  keyRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  keyInput: { flex: "1 1 240px" },
  tiles: { display: "grid", gridTemplateColumns: { default: "repeat(2, minmax(0, 1fr))", [bp.mobile]: "minmax(0, 1fr)" }, gap: 10 },
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 },
  hint: { marginLeft: "auto", fontSize: 12.5, color: color.textMuted },
});

/** Entries the learner has not seen, oldest first, like the unread part of a changelog. */
const unseen = (settings: Settings): IntroFeature[] => INTRO_FEATURES.filter((f) => !settings.introSeen.includes(f));


/** Shows the tour again from the start, e.g. from Settings. */
export const INTRO_EVENT = "clayfold:intro";

/**
 * On entering the app, shows each "What's new" entry the learner has not seen: what arrived, how it works and what
 * it runs on; an optional feature's entry offers to turn it on while it is off. Unlock celebrations wait while it is open.
 */
export function Intro() {
  useLang();
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [steps, setSteps] = useState<IntroFeature[]>([]);
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const keyId = useId();
  const open = steps.length > 0 && at < steps.length;
  useCelebrationHold(open);

  useEffect(() => {
    const load = () =>
      api.settings().then(
        (next) => {
          setSettings(next);
          setSteps(unseen(next));
          setAt(0);
        },
        () => {},
      );
    void load();
    window.addEventListener(INTRO_EVENT, load);
    return () => window.removeEventListener(INTRO_EVENT, load);
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const feature = steps[at];
  const toggle = feature ? TOGGLES[feature] : undefined;

  const decide = async (on: boolean) => {
    if (!feature) return;
    setBusy(true);
    setError(null);
    try {
      const seen = [...(settings?.introSeen ?? []), feature];
      const next = await api.setSettings({ introSeen: seen, ...(on ? TOGGLES[feature]?.update : {}) });
      setSettings(next);
      if (feature === "game") setGameOn(next.gamification);
      setAt((n) => n + 1);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const closeAll = () => {
    void api.setSettings({ introSeen: [...(settings?.introSeen ?? []), ...steps.slice(at)] }).catch(() => {});
    setAt(steps.length);
  };

  // The video entry asks for the ElevenLabs key it needs; the sources entry offers the optional Exa key.
  const keyFor = (f: IntroFeature | undefined, s: Settings) =>
    f === "video" && !s.narration.keySet ? KEY_FORMS.video : f === "sources" && !s.sources.exaKeySet ? KEY_FORMS.sources : null;
  const keyForm = feature && settings ? keyFor(feature, settings) : null;

  const saveKey = async () => {
    if (!keyForm) return;
    setBusy(true);
    setError(null);
    try {
      setSettings(await keyForm.save(key.trim()));
      setKey("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} aria-labelledby="intro-title" onCancel={(e) => (e.preventDefault(), closeAll())} {...stylex.props(s.dialog)}>
      {feature && settings && (
        <div key={feature} {...stylex.props(s.inner)}>
          <div {...stylex.props(s.top)}>
            <span {...stylex.props(s.kicker)}>
              {t("intro.kicker")} · {dateFormat({ day: "numeric", month: "long" }).format(new Date(`${INTRO_RELEASED[feature]}T12:00:00`))}
            </span>
            {steps.length > 1 && (
              <span aria-label={t("intro.step", { n: at + 1, total: steps.length })} {...stylex.props(s.dots)}>
                {steps.map((f, i) => (
                  <span key={f} {...stylex.props(s.dot, i === at && s.dotOn)} />
                ))}
              </span>
            )}
            <button type="button" aria-label={t("intro.close")} onClick={closeAll} {...stylex.props(btn.base, btn.icon, btn.iconSm, steps.length > 1 ? s.close : s.closeAlone)}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <div {...stylex.props(s.hero)}>
            <div
              {...stylex.props(s.heroArt)}
              style={{ backgroundImage: feature === "game" ? "linear-gradient(180deg, #FFE9CF, #F2C69B)" : ART[feature].bg }}
            >
              {feature === "game" ? <Meerkat pose="cheer" size={92} react={{ kind: "hop", n: 1 }} /> : <HeroIcon feature={feature} />}
            </div>
            <div>
              <h2 id="intro-title" {...stylex.props(s.title)}>
                {t(`intro.${feature}.title`)}
              </h2>
              <p {...stylex.props(s.why)}>{t(`intro.${feature}.why`)}</p>
            </div>
          </div>

          <div>
            <p {...stylex.props(s.label)}>{t(toggle ? "intro.how" : "intro.whatsIn")}</p>
            <ol {...stylex.props(toggle ? s.flow : s.tiles, s.flowList)}>
              {FLOWS[feature].map((step, i) => {
                const tone = TONES[i % TONES.length]!;
                const Icon = step.icon;
                return (
                  <Fragment key={step.title}>
                    {toggle && i > 0 && <li aria-hidden="true" {...stylex.props(s.arrow)} />}
                    <li {...stylex.props(s.stepCard)} style={{ backgroundColor: tone.bg }}>
                      <span {...stylex.props(s.stepTop)}>
                        {toggle && (
                          <span {...stylex.props(s.stepNum)} style={{ backgroundColor: tone.ink }}>
                            {i + 1}
                          </span>
                        )}
                        <Icon size={20} color={tone.ink} aria-hidden="true" />
                      </span>
                      <span {...stylex.props(s.stepTitle)}>{t(step.title)}</span>
                      <span {...stylex.props(s.stepBody)}>{t(step.body)}</span>
                    </li>
                  </Fragment>
                );
              })}
            </ol>
          </div>

          <p {...stylex.props(s.plan)}>
            <Sparkles size={18} aria-hidden="true" {...stylex.props(s.planIcon)} />
            <span>{t(`intro.${feature}.plan`)}</span>
          </p>

          {keyForm && (
            <form
              {...stylex.props(field.stack)}
              onSubmit={(e) => {
                e.preventDefault();
                void saveKey();
              }}
            >
              <label htmlFor={keyId} {...stylex.props(field.label)}>
                {t(keyForm.label)}
              </label>
              <div {...stylex.props(s.keyRow)}>
                <input id={keyId} type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} {...stylex.props(field.input, s.keyInput)} />
                <button type="submit" disabled={busy || key.trim().length < 10} {...stylex.props(btn.base, btn.ghost)}>
                  {t("settings.saveKey")}
                </button>
              </div>
              <p {...stylex.props(text.xs, text.muted)}>{t(keyForm.hint)}</p>
            </form>
          )}

          {error && (
            <p role="alert" {...stylex.props(text.error)}>
              {error}
            </p>
          )}

          <div {...stylex.props(s.actions)}>
            {!toggle || toggle.on(settings) ? (
              <>
                {toggle && (
                  <span {...stylex.props(chip.base, chip.pistachio)}>
                    <Check size={14} aria-hidden="true" /> {t("intro.alreadyOn")}
                  </span>
                )}
                <button type="button" disabled={busy} onClick={() => void decide(false)} {...stylex.props(btn.base, btn.primary, btn.lg)}>
                  {busy && <Spinner />} {t(at + 1 < steps.length ? "intro.next" : "intro.gotIt")}
                </button>
              </>
            ) : (
              <>
                <button type="button" disabled={busy} onClick={() => void decide(true)} {...stylex.props(btn.base, btn.primary, btn.lg)}>
                  {busy && <Spinner />} {t(toggle.label)}
                </button>
                <button type="button" disabled={busy} onClick={() => void decide(false)} {...stylex.props(btn.base, btn.ghost, btn.lg)}>
                  {t("intro.later")}
                </button>
              </>
            )}
            {toggle && <span {...stylex.props(s.hint)}>{t("intro.settingsHint")}</span>}
          </div>
        </div>
      )}
    </dialog>
  );
}

function HeroIcon({ feature }: { feature: Exclude<IntroFeature, "game"> }) {
  const { icon: Icon, ink } = ART[feature];
  return <Icon size={60} color={ink} aria-hidden="true" />;
}
