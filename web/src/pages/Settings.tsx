import * as stylex from "@stylexjs/stylex";
import { AudioLines, BookOpen, Check, Clapperboard, KeyRound, Play, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { useId, useRef, useState } from "react";
import { CLAUDE_MODELS, CLAUDE_ROLES, EFFORTS, TTS_MODELS, supportsEffort, type ClaudeModel, type Effort, type Settings, type SettingsUpdate } from "@shared/api";
import { Segmented, Select, Switch } from "../components/controls";
import { useHeader } from "../components/header";
import { INTRO_EVENT } from "../components/Intro";
import { Meerkat } from "../components/meerkat/Meerkat";
import { CardHead, ErrorBox, PageLoading, Spinner } from "../components/ui";
import { api, errorText } from "../lib/api";
import { setGameOn } from "../lib/game";
import { t, useLang } from "../lib/i18n";
import { READING_DEFAULTS, READING_OPTIONS, setReading, useReading, useSystemReducedMotion, type Reading } from "../lib/reading";
import { useResource } from "../lib/useResource";
import { bp, color, font, radius, reading } from "../theme/tokens.stylex";
import { banner, btn, card, chip, field, layout, readable, text } from "../theme/ui";

const s = stylex.create({
  page: { display: "grid", gridTemplateColumns: { default: "repeat(2, minmax(0, 1fr))", [bp.mobile]: "minmax(0, 1fr)" }, gap: 20, alignItems: "stretch" },
  split: { display: "grid", gridTemplateColumns: { default: "repeat(2, minmax(0, 1fr))", [bp.mobile]: "minmax(0, 1fr)" }, gap: 24 },
  card: { display: "flex", flexDirection: "column", gap: 16 },
  fill: { flexGrow: 1, display: "grid", gap: 10, alignContent: "start" },
  wide: { gridColumn: "1 / -1" },
  intro: { maxWidth: "70ch" },
  feature: { display: "flex", alignItems: "center", gap: 14 },
  featureArt: { flexShrink: 0, display: "grid", placeItems: "center", width: 72, height: 72, borderRadius: radius.inner, backgroundColor: "rgb(255 255 255 / 0.55)" },
  game: { backgroundImage: `linear-gradient(135deg, ${color.butter}, ${color.peachSoft})` },
  video: { backgroundImage: `linear-gradient(135deg, ${color.lilacSoft}, ${color.surface})` },
  narrationArt: { backgroundColor: color.peachSoft },
  whatsNew: { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 16 },
  keyRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  keyInput: { flex: "1 1 200px" },
  voiceRow: { display: "flex", gap: 8, alignItems: "center" },
  grow: { flex: 1, minWidth: 0 },
  roles: { display: "grid", gridTemplateColumns: { default: "repeat(3, minmax(0, 1fr))", [bp.mobile]: "minmax(0, 1fr)" }, gap: 12 },
  role: { display: "grid", gap: 8, padding: 14, borderRadius: radius.inner, backgroundColor: color.surface2 },
  roleName: { fontWeight: 700, fontSize: 14.5 },
  roleRow: { display: "grid", gap: 8 },
  readingArt: { backgroundColor: color.pistachioSoft },
  controls: { display: "flex", flexWrap: "wrap", columnGap: 32, rowGap: 20, alignItems: "flex-start" },
  withHint: { maxWidth: 360 },
  glyph: (px: number) => ({ fontSize: px, fontWeight: 700, lineHeight: 1 }),
  caption: { fontFamily: font.body },
  preview: { display: "grid", gap: 10, paddingBlock: 22, paddingInline: 24, borderWidth: 1.5, borderStyle: "solid", borderColor: color.border, borderRadius: radius.inner },
  previewBody: { fontSize: `calc(17px * ${reading.scale})` },
});

const SIZE_GLYPH: Record<Reading["size"], number> = { s: 12, m: 15, l: 18, xl: 21, xxl: 25 };

export function SettingsPage() {
  useLang();
  useHeader({ title: t("settings.title") });
  const settings = useResource(() => api.settings(), "settings");
  if (settings.error && !settings.data) return <ErrorBox error={settings.error} onRetry={() => void settings.reload()} />;
  if (!settings.data) return <PageLoading />;
  const onChange = (next: Settings) => settings.setData(() => next);
  return (
    <div {...stylex.props(s.page)}>
      <ReadingSettings />
      <GameSettings settings={settings.data} onChange={onChange} />
      <VideoSettings settings={settings.data} onChange={onChange} />
      <NarrationSettings settings={settings.data} onChange={onChange} />
      <ClaudeSettings settings={settings.data} onChange={onChange} />
      <WhatsNew onChange={onChange} />
    </div>
  );
}

/** Clears the tour's marks and opens it again. */
function WhatsNew({ onChange }: { onChange: (next: Settings) => void }) {
  useLang();
  const { busy, error, save } = useSave(onChange);
  const replay = () =>
    void save(async () => {
      const next = await api.setSettings({ introSeen: [] });
      window.dispatchEvent(new Event(INTRO_EVENT));
      return next;
    });
  return (
    <section aria-labelledby="settings-whatsnew" {...stylex.props(card.base, s.wide, s.whatsNew)}>
      <div>
        <h2 id="settings-whatsnew" {...stylex.props(text.h3)}>
          {t("settings.whatsNew")}
        </h2>
        <p {...stylex.props(text.small, text.muted)}>{t("settings.whatsNewHint")}</p>
      </div>
      <button type="button" disabled={busy} onClick={replay} {...stylex.props(btn.base, btn.ghost)}>
        <Sparkles size={16} aria-hidden="true" /> {t("settings.whatsNewShow")}
      </button>
      <SaveStatus error={error} saved={false} />
    </section>
  );
}

/** Stored in this browser like the theme, not in the server settings, and applied as they change. */
function ReadingSettings() {
  useLang();
  const pref = useReading();
  const systemReduce = useSystemReducedMotion();
  const [termBefore, termAfter = ""] = t("settings.reading.previewBody").split("{term}");
  const [codeBefore, codeAfter = ""] = t("settings.reading.previewCode").split("{code}");
  const body = stylex.props(s.previewBody);
  const changed = (Object.keys(READING_DEFAULTS) as (keyof Reading)[]).some((key) => pref[key] !== READING_DEFAULTS[key]);

  return (
    <section aria-labelledby="settings-reading" {...stylex.props(card.base, s.card, s.wide)}>
      <div {...stylex.props(s.feature)}>
        <span {...stylex.props(s.featureArt, s.readingArt)}>
          <BookOpen size={34} aria-hidden="true" />
        </span>
        <CardHead id="settings-reading" title={t("settings.reading")}>
          {changed && (
            <button type="button" onClick={() => setReading(READING_DEFAULTS)} {...stylex.props(btn.base, btn.ghost, btn.sm)}>
              <RotateCcw size={14} aria-hidden="true" /> {t("settings.reading.reset")}
            </button>
          )}
        </CardHead>
      </div>
      <p {...stylex.props(text.small, s.intro)}>{t("settings.readingIntro")}</p>
      <div {...stylex.props(s.controls)}>
        <div {...stylex.props(field.stack)}>
          <span {...stylex.props(field.label)}>{t("settings.reading.size")}</span>
          <Segmented
            compact
            label={t("settings.reading.size")}
            value={pref.size}
            options={READING_OPTIONS.size.map((value) => ({
              value,
              label: t(`settings.reading.size.${value}`),
              content: <span {...stylex.props(s.glyph(SIZE_GLYPH[value]))}>{t("settings.reading.sizeGlyph")}</span>,
            }))}
            onChange={(size) => setReading({ size })}
          />
        </div>
        <div {...stylex.props(field.stack)}>
          <span {...stylex.props(field.label)}>{t("settings.reading.leading")}</span>
          <Segmented
            compact
            label={t("settings.reading.leading")}
            value={pref.leading}
            options={READING_OPTIONS.leading.map((value) => ({ value, label: t(`settings.reading.leading.${value}`) }))}
            onChange={(leading) => setReading({ leading })}
          />
        </div>
        <div {...stylex.props(field.stack)}>
          <span {...stylex.props(field.label)}>{t("settings.reading.measure")}</span>
          <Segmented
            compact
            label={t("settings.reading.measure")}
            value={pref.measure}
            options={READING_OPTIONS.measure.map((value) => ({ value, label: t(`settings.reading.measure.${value}`) }))}
            onChange={(measure) => setReading({ measure })}
          />
        </div>
        <div {...stylex.props(field.stack, s.withHint)}>
          <span {...stylex.props(field.label)}>{t("settings.reading.font")}</span>
          <Segmented
            compact
            label={t("settings.reading.font")}
            value={pref.font}
            options={READING_OPTIONS.font.map((value) => ({ value, label: t(`settings.reading.font.${value}`) }))}
            onChange={(font) => setReading({ font })}
          />
          <p {...stylex.props(text.muted, text.small)}>{t("settings.reading.fontHint")}</p>
        </div>
        <div {...stylex.props(field.stack, s.withHint)}>
          <span {...stylex.props(field.label)}>{t("settings.reading.motionTitle")}</span>
          <Switch
            checked={systemReduce || pref.motion === "reduce"}
            disabled={systemReduce}
            onChange={(on) => setReading({ motion: on ? "reduce" : "system" })}
            label={t("settings.reading.motion")}
          />
          <p {...stylex.props(text.muted, text.small)}>{t(systemReduce ? "settings.reading.motionSystem" : "settings.reading.motionHint")}</p>
        </div>
      </div>
      <figure aria-labelledby="settings-reading-preview" {...stylex.props(s.preview, readable.surface)}>
        <figcaption id="settings-reading-preview" {...stylex.props(field.label, s.caption)}>
          {t("settings.reading.preview")}
        </figcaption>
        <div className={`prose ${body.className ?? ""}`} style={body.style}>
          <h3>{t("settings.reading.previewTitle")}</h3>
          <p>
            {termBefore}
            <span className="term">{t("settings.reading.previewTerm")}</span>
            {termAfter}
          </p>
          <ul>
            <li>{t("settings.reading.previewStep1")}</li>
            <li>{t("settings.reading.previewStep2")}</li>
            <li>{t("settings.reading.previewStep3")}</li>
          </ul>
          <p>
            {codeBefore}
            <code>{t("settings.reading.previewCodeSample")}</code>
            {codeAfter}
          </p>
        </div>
      </figure>
    </section>
  );
}

function useSave(onChange: (next: Settings) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = async (call: () => Promise<Settings>) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      onChange(await call());
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, saved, save };
}

function SaveStatus({ error, saved }: { error: string | null; saved: boolean }) {
  useLang();
  if (error) {
    return (
      <p role="alert" {...stylex.props(text.error)}>
        {error}
      </p>
    );
  }
  if (!saved) return null;
  return (
    <p role="status" {...stylex.props(text.saved)}>
      <Check size={16} aria-hidden="true" /> {t("settings.saved")}
    </p>
  );
}

function GameSettings({ settings, onChange }: { settings: Settings; onChange: (next: Settings) => void }) {
  useLang();
  const { busy, error, saved, save } = useSave((next) => {
    onChange(next);
    setGameOn(next.gamification);
  });
  return (
    <section aria-labelledby="settings-game" {...stylex.props(card.base, s.card, s.game)}>
      <div {...stylex.props(s.feature)}>
        <span {...stylex.props(s.featureArt)}>
          <Meerkat pose={settings.gamification ? "cheer" : "idle"} size={52} />
        </span>
        <CardHead id="settings-game" title={t("settings.game")} />
      </div>
      <div {...stylex.props(s.fill)}>
        <p {...stylex.props(text.small, s.intro)}>{t("settings.gameIntro")}</p>
        <p {...stylex.props(text.xs, text.muted, s.intro)}>{t("settings.gameCost")}</p>
      </div>
      <Switch
        checked={settings.gamification}
        disabled={busy}
        onChange={(on) => void save(() => api.setSettings({ gamification: on }))}
        label={t(settings.gamification ? "settings.gameOn" : "settings.gameOff")}
      />
      <SaveStatus error={error} saved={saved} />
    </section>
  );
}

function VideoSettings({ settings, onChange }: { settings: Settings; onChange: (next: Settings) => void }) {
  useLang();
  const { busy, error, saved, save } = useSave(onChange);
  const enabled = settings.video.enabled;
  return (
    <section aria-labelledby="settings-video" {...stylex.props(card.base, s.card, s.video)}>
      <div {...stylex.props(s.feature)}>
        <span {...stylex.props(s.featureArt)}>
          <Clapperboard size={34} aria-hidden="true" />
        </span>
        <CardHead id="settings-video" title={t("settings.video")} />
      </div>
      <div {...stylex.props(s.fill)}>
        <p {...stylex.props(text.small, s.intro)}>{t("settings.videoIntro")}</p>
        {enabled && !settings.narration.keySet && <p {...stylex.props(text.xs, text.muted, s.intro)}>{t("settings.videoNeedsKey")}</p>}
      </div>
      <Switch checked={enabled} disabled={busy} onChange={(on) => void save(() => api.setSettings({ videoEnabled: on }))} label={t("settings.videoToggle")} />
      <SaveStatus error={error} saved={saved} />
    </section>
  );
}

function NarrationSettings({ settings, onChange }: { settings: Settings; onChange: (next: Settings) => void }) {
  useLang();
  const { keySet, voiceId, model } = settings.narration;
  const [key, setKey] = useState("");
  const { busy, error, saved, save } = useSave(onChange);
  const voices = useResource(() => api.voices(), keySet ? "voices" : null);
  const sample = useRef<HTMLAudioElement | null>(null);
  const keyId = useId();

  const update = (body: SettingsUpdate) => void save(() => api.setSettings(body));

  const playSample = () => {
    const url = voices.data?.find((v) => v.id === voiceId)?.previewUrl;
    if (!url) return;
    sample.current?.pause();
    sample.current = new Audio(url);
    void sample.current.play().catch(() => {});
  };

  return (
    <section aria-labelledby="settings-narration" {...stylex.props(card.base, s.card, s.wide)}>
      <div {...stylex.props(s.feature)}>
        <span {...stylex.props(s.featureArt, s.narrationArt)}>
          <AudioLines size={34} aria-hidden="true" />
        </span>
        <CardHead id="settings-narration" title={t("settings.narration")}>
          {keySet && (
            <span {...stylex.props(chip.base, chip.pistachio)}>
              <KeyRound size={14} aria-hidden="true" /> {t("settings.keySet")}
            </span>
          )}
        </CardHead>
      </div>
      <div {...stylex.props(s.split)}>
        <div {...stylex.props(s.fill)}>
          <p {...stylex.props(text.small, text.muted, s.intro)}>{t("settings.narrationIntro")}</p>
          {keySet && <p {...stylex.props(text.xs, text.muted, s.intro)}>{t("settings.costNote")}</p>}
          {keySet && (
            <div>
              <button type="button" disabled={busy} onClick={() => void save(() => api.removeElevenLabsKey())} {...stylex.props(btn.base, btn.ghost, btn.sm)}>
                {t("settings.removeKey")}
              </button>
            </div>
          )}
        </div>
        {keySet ? (
          <div {...stylex.props(s.fill)}>
            <div {...stylex.props(field.stack)}>
              <span {...stylex.props(field.label)}>{t("settings.voice")}</span>
              {voices.error ? (
                <ErrorBox error={voices.error} onRetry={() => void voices.reload()} />
              ) : (
                <div {...stylex.props(s.voiceRow)}>
                  <div {...stylex.props(s.grow)}>
                    <Select
                      label={t("settings.voice")}
                      value={voiceId}
                      placeholder={t("common.loading")}
                      disabled={busy || !voices.data}
                      options={(voices.data ?? []).map((v) => ({ value: v.id, label: v.name }))}
                      onChange={(id) => update({ voiceId: id })}
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={t("settings.playSample")}
                    title={t("settings.playSample")}
                    disabled={!voices.data?.find((v) => v.id === voiceId)?.previewUrl}
                    onClick={playSample}
                    {...stylex.props(btn.base, btn.icon)}
                  >
                    <Play size={18} aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
            <div {...stylex.props(field.stack)}>
              <span {...stylex.props(field.label)}>{t("settings.model")}</span>
              <Segmented
                label={t("settings.model")}
                value={model}
                disabled={busy}
                options={TTS_MODELS.map((m) => ({ value: m, label: t(`settings.model.${m}`) }))}
                onChange={(m) => update({ ttsModel: m })}
              />
            </div>
          </div>
        ) : (
          <form
            {...stylex.props(field.stack)}
            onSubmit={(e) => {
              e.preventDefault();
              void save(() => api.setElevenLabsKey(key.trim())).then(() => setKey(""));
            }}
          >
            <label htmlFor={keyId} {...stylex.props(field.label)}>
              {t("settings.key")}
            </label>
            <div {...stylex.props(s.keyRow)}>
              <input
                id={keyId}
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                {...stylex.props(field.input, s.keyInput)}
              />
              <button type="submit" disabled={busy || key.trim().length < 10} {...stylex.props(btn.base, btn.primary)}>
                {busy && <Spinner />} {t("settings.saveKey")}
              </button>
            </div>
            <p {...stylex.props(text.muted, text.xs)}>{t("settings.keyHint")}</p>
          </form>
        )}
      </div>

      <SaveStatus error={error} saved={saved} />
    </section>
  );
}

function ClaudeSettings({ settings, onChange }: { settings: Settings; onChange: (next: Settings) => void }) {
  useLang();
  const { busy, error, saved, save } = useSave(onChange);
  const roles = settings.claude;
  const modelOf = (role: keyof Settings["claude"]) => roles[role].model ?? roles[role].defaultModel;
  const sameCritic = modelOf("lesson") === modelOf("critic");
  const update = (role: keyof Settings["claude"], change: { model?: ClaudeModel | null; effort?: Effort | null }) => {
    const { model, effort } = { ...roles[role], ...change };
    void save(() => api.setSettings({ claudeRole: { role, model, effort } }));
  };

  return (
    <section aria-labelledby="settings-claude" {...stylex.props(card.base, s.card, s.wide)}>
      <CardHead id="settings-claude" title={t("settings.claude")} />
      <p {...stylex.props(text.small, text.muted, s.intro)}>{t("settings.claudeIntro")}</p>
      <ul {...stylex.props(layout.plainList, s.roles)}>
        {CLAUDE_ROLES.map((role) => {
          const label = t(`claudeMode.kind.${role}`);
          const effortSupported = supportsEffort(modelOf(role));
          return (
            <li key={role} {...stylex.props(s.role)}>
              <span {...stylex.props(s.roleName)}>{label}</span>
              <div {...stylex.props(s.roleRow)}>
                <Select<ClaudeModel | "">
                  label={`${label}: ${t("settings.claude.model")}`}
                  value={roles[role].model ?? ""}
                  disabled={busy}
                  options={[
                    { value: "", label: t("settings.claude.defaultModel", { model: roles[role].defaultModel }) },
                    ...CLAUDE_MODELS.map((m) => ({ value: m, label: m })),
                  ]}
                  onChange={(m) => update(role, { model: m || null })}
                />
                <Select<Effort | "">
                  label={`${label}: ${t("settings.claude.effort")}`}
                  value={effortSupported ? (roles[role].effort ?? "") : ""}
                  disabled={busy || !effortSupported}
                  options={[
                    {
                      value: "",
                      label: effortSupported ? t("settings.claude.defaultEffort", { effort: t(`settings.effort.${roles[role].defaultEffort}`) }) : t("settings.claude.noEffort"),
                    },
                    ...EFFORTS.map((level) => ({ value: level, label: t(`settings.effort.${level}`) })),
                  ]}
                  onChange={(e) => update(role, { effort: e || null })}
                />
              </div>
            </li>
          );
        })}
      </ul>
      {sameCritic && (
        <p {...stylex.props(banner.base, banner.butter, s.intro)}>
          <TriangleAlert size={18} aria-hidden="true" /> {t("settings.claude.sameCritic", { model: modelOf("lesson") })}
        </p>
      )}
      <SaveStatus error={error} saved={saved} />
    </section>
  );
}
