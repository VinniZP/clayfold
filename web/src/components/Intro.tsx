import * as stylex from "@stylexjs/stylex";
import { AudioLines, BookOpen, Clapperboard, Crown, FileText, PawPrint, PenLine, PlayCircle, Sparkles, X, type LucideIcon } from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { INTRO_FEATURES, type IntroFeature, type Settings } from "@shared/api";
import type { MessageKey } from "@shared/i18n";
import { api, errorText } from "../lib/api";
import { setGameOn, useCelebrationHold } from "../lib/game";
import { t, useLang } from "../lib/i18n";
import { bp, color, font, radius } from "../theme/tokens.stylex";
import { btn, field, text } from "../theme/ui";
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
};

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
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 },
  hint: { marginLeft: "auto", fontSize: 12.5, color: color.textMuted },
});

/** A feature is offered once, and only while it is off. */
const offered = (settings: Settings): IntroFeature[] =>
  INTRO_FEATURES.filter((f) => !settings.introSeen.includes(f) && !(f === "game" ? settings.gamification : settings.video.enabled));

/**
 * On entering the app, offers the optional features the learner has not decided on yet: what each does, how it
 * works and what it costs, with a switch to turn it on. Unlock celebrations wait while it is open.
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
    api.settings().then(
      (next) => {
        setSettings(next);
        setSteps(offered(next));
      },
      () => {},
    );
  }, []);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const feature = steps[at];

  const decide = async (on: boolean) => {
    if (!feature) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.setSettings({ introSeen: [feature], ...(on ? (feature === "game" ? { gamification: true } : { videoEnabled: true }) : {}) });
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
    void api.setSettings({ introSeen: steps.slice(at) }).catch(() => {});
    setAt(steps.length);
  };

  const saveKey = async () => {
    setBusy(true);
    setError(null);
    try {
      setSettings(await api.setElevenLabsKey(key.trim()));
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
            <span {...stylex.props(s.kicker)}>{t("intro.kicker")}</span>
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
              style={{ backgroundImage: feature === "game" ? "linear-gradient(180deg, #FFE9CF, #F2C69B)" : "linear-gradient(160deg, #E7E5FB, #CBC9F5)" }}
            >
              {feature === "game" ? <Meerkat pose="cheer" size={92} react={{ kind: "hop", n: 1 }} /> : <Clapperboard size={60} color="#5640AE" aria-hidden="true" />}
            </div>
            <div>
              <h2 id="intro-title" {...stylex.props(s.title)}>
                {t(`intro.${feature}.title`)}
              </h2>
              <p {...stylex.props(s.why)}>{t(`intro.${feature}.why`)}</p>
            </div>
          </div>

          <div>
            <p {...stylex.props(s.label)}>{t("intro.how")}</p>
            <ol {...stylex.props(s.flow, s.flowList)}>
              {FLOWS[feature].map((step, i) => {
                const tone = TONES[i % TONES.length]!;
                const Icon = step.icon;
                return (
                  <Fragment key={step.title}>
                    {i > 0 && <li aria-hidden="true" {...stylex.props(s.arrow)} />}
                    <li {...stylex.props(s.stepCard)} style={{ backgroundColor: tone.bg }}>
                      <span {...stylex.props(s.stepTop)}>
                        <span {...stylex.props(s.stepNum)} style={{ backgroundColor: tone.ink }}>
                          {i + 1}
                        </span>
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

          {feature === "video" && !settings.narration.keySet && (
            <form
              {...stylex.props(field.stack)}
              onSubmit={(e) => {
                e.preventDefault();
                void saveKey();
              }}
            >
              <label htmlFor={keyId} {...stylex.props(field.label)}>
                {t("intro.video.key")}
              </label>
              <div {...stylex.props(s.keyRow)}>
                <input id={keyId} type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} {...stylex.props(field.input, s.keyInput)} />
                <button type="submit" disabled={busy || key.trim().length < 10} {...stylex.props(btn.base, btn.ghost)}>
                  {t("settings.saveKey")}
                </button>
              </div>
              <p {...stylex.props(text.xs, text.muted)}>{t("settings.keyHint")}</p>
            </form>
          )}

          {error && (
            <p role="alert" {...stylex.props(text.error)}>
              {error}
            </p>
          )}

          <div {...stylex.props(s.actions)}>
            <button type="button" disabled={busy} onClick={() => void decide(true)} {...stylex.props(btn.base, btn.primary, btn.lg)}>
              {busy && <Spinner />} {t(`intro.${feature}.on`)}
            </button>
            <button type="button" disabled={busy} onClick={() => void decide(false)} {...stylex.props(btn.base, btn.ghost, btn.lg)}>
              {t("intro.later")}
            </button>
            <span {...stylex.props(s.hint)}>{t("intro.settingsHint")}</span>
          </div>
        </div>
      )}
    </dialog>
  );
}
