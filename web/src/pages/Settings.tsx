import * as stylex from "@stylexjs/stylex";
import { AudioLines, Check, Clapperboard, KeyRound, Play, TriangleAlert } from "lucide-react";
import { useId, useRef, useState } from "react";
import { CLAUDE_MODELS, CLAUDE_ROLES, EFFORTS, TTS_MODELS, supportsEffort, type ClaudeModel, type Effort, type Settings, type SettingsUpdate } from "@shared/api";
import { Segmented, Select, Switch } from "../components/controls";
import { useHeader } from "../components/header";
import { Meerkat } from "../components/meerkat/Meerkat";
import { CardHead, ErrorBox, PageLoading, Spinner } from "../components/ui";
import { api, errorText } from "../lib/api";
import { setGameOn } from "../lib/game";
import { t, useLang } from "../lib/i18n";
import { useResource } from "../lib/useResource";
import { bp, color, radius } from "../theme/tokens.stylex";
import { banner, btn, card, chip, field, layout, text } from "../theme/ui";

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
  keyRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  keyInput: { flex: "1 1 200px" },
  voiceRow: { display: "flex", gap: 8, alignItems: "center" },
  grow: { flex: 1, minWidth: 0 },
  roles: { display: "grid", gridTemplateColumns: { default: "repeat(3, minmax(0, 1fr))", [bp.mobile]: "minmax(0, 1fr)" }, gap: 12 },
  role: { display: "grid", gap: 8, padding: 14, borderRadius: radius.inner, backgroundColor: color.surface2 },
  roleName: { fontWeight: 700, fontSize: 14.5 },
  roleRow: { display: "grid", gap: 8 },
});

export function SettingsPage() {
  useLang();
  useHeader({ title: t("settings.title") });
  const settings = useResource(() => api.settings(), "settings");
  if (settings.error && !settings.data) return <ErrorBox error={settings.error} onRetry={() => void settings.reload()} />;
  if (!settings.data) return <PageLoading />;
  const onChange = (next: Settings) => settings.setData(() => next);
  return (
    <div {...stylex.props(s.page)}>
      <GameSettings settings={settings.data} onChange={onChange} />
      <VideoSettings settings={settings.data} onChange={onChange} />
      <NarrationSettings settings={settings.data} onChange={onChange} />
      <ClaudeSettings settings={settings.data} onChange={onChange} />
    </div>
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
