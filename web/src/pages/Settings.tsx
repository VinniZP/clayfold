import * as stylex from "@stylexjs/stylex";
import { Check, KeyRound, Play, TriangleAlert } from "lucide-react";
import { useId, useRef, useState } from "react";
import { CLAUDE_MODELS, CLAUDE_ROLES, EFFORTS, TTS_MODELS, supportsEffort, type ClaudeModel, type Effort, type Settings, type SettingsUpdate } from "@shared/api";
import { useHeader } from "../components/header";
import { CardHead, ErrorBox, PageLoading, Spinner } from "../components/ui";
import { api, errorText } from "../lib/api";
import { t, useLang } from "../lib/i18n";
import { useResource } from "../lib/useResource";
import { card, banner, btn, chip, field, layout, text } from "../theme/ui";

const s = stylex.create({
  card: { display: "grid", gap: 20, maxWidth: 760 },
  intro: { maxWidth: "62ch" },
  keyRow: { display: "flex", gap: 8, flexWrap: "wrap", maxWidth: 560 },
  keyInput: { flex: "1 1 260px" },
  voiceRow: { display: "flex", gap: 8, alignItems: "center", maxWidth: 560 },
  radios: { display: "grid", gap: 8, margin: 0, padding: 0, borderWidth: 0 },
  page: { display: "grid", gap: 24 },
  roles: { display: "grid", gridTemplateColumns: "minmax(90px, auto) minmax(0, 1fr) minmax(0, 1fr)", gap: 8, alignItems: "center", maxWidth: 700 },
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
      <ClaudeSettings settings={settings.data} onChange={onChange} />
      <NarrationSettings settings={settings.data} onChange={onChange} />
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
    <section aria-labelledby="settings-claude" {...stylex.props(card.base, s.card)}>
      <CardHead id="settings-claude" title={t("settings.claude")} />
      <p {...stylex.props(text.muted, s.intro)}>{t("settings.claudeIntro")}</p>
      <div {...stylex.props(s.roles)}>
        <span {...stylex.props(field.label)}>{t("settings.claude.role")}</span>
        <span {...stylex.props(field.label)}>{t("settings.claude.model")}</span>
        <span {...stylex.props(field.label)}>{t("settings.claude.effort")}</span>
        {CLAUDE_ROLES.map((role) => {
          const label = t(`claudeMode.kind.${role}`);
          const effortSupported = supportsEffort(modelOf(role));
          return [
            <span key={`${role}-label`}>{label}</span>,
            <select
              key={`${role}-model`}
              aria-label={`${label}: ${t("settings.claude.model")}`}
              value={roles[role].model ?? ""}
              disabled={busy}
              onChange={(e) => update(role, { model: (e.target.value || null) as ClaudeModel | null })}
              {...stylex.props(field.input, field.select)}
            >
              <option value="">{t("settings.claude.defaultModel", { model: roles[role].defaultModel })}</option>
              {CLAUDE_MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>,
            <select
              key={`${role}-effort`}
              aria-label={`${label}: ${t("settings.claude.effort")}`}
              value={effortSupported ? (roles[role].effort ?? "") : ""}
              disabled={busy || !effortSupported}
              onChange={(e) => update(role, { effort: (e.target.value || null) as Effort | null })}
              {...stylex.props(field.input, field.select)}
            >
              <option value="">
                {effortSupported ? t("settings.claude.defaultEffort", { effort: t(`settings.effort.${roles[role].defaultEffort}`) }) : t("settings.claude.noEffort")}
              </option>
              {EFFORTS.map((level) => (
                <option key={level} value={level}>
                  {t(`settings.effort.${level}`)}
                </option>
              ))}
            </select>,
          ];
        })}
      </div>
      {sameCritic && (
        <p {...stylex.props(banner.base, banner.butter, s.intro)}>
          <TriangleAlert size={18} aria-hidden="true" /> {t("settings.claude.sameCritic", { model: modelOf("lesson") })}
        </p>
      )}
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
  const voiceSelectId = useId();

  const update = (body: SettingsUpdate) => void save(() => api.setSettings(body));

  const playSample = () => {
    const url = voices.data?.find((v) => v.id === voiceId)?.previewUrl;
    if (!url) return;
    sample.current?.pause();
    sample.current = new Audio(url);
    void sample.current.play().catch(() => {});
  };

  return (
    <section aria-labelledby="settings-narration" {...stylex.props(card.base, s.card)}>
      <CardHead id="settings-narration" title={t("settings.narration")}>
        {keySet && (
          <span {...stylex.props(chip.base, chip.pistachio)}>
            <KeyRound size={14} aria-hidden="true" /> {t("settings.keySet")}
          </span>
        )}
      </CardHead>
      <p {...stylex.props(text.muted, s.intro)}>{t("settings.narrationIntro")}</p>

      {keySet ? (
        <div {...stylex.props(layout.row)}>
          <button type="button" disabled={busy} onClick={() => void save(() => api.removeElevenLabsKey())} {...stylex.props(btn.base, btn.ghost, btn.sm)}>
            {t("settings.removeKey")}
          </button>
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
          <p {...stylex.props(text.muted, text.small)}>{t("settings.keyHint")}</p>
        </form>
      )}

      {keySet && (
        <>
          <div {...stylex.props(field.stack)}>
            <label htmlFor={voiceSelectId} {...stylex.props(field.label)}>
              {t("settings.voice")}
            </label>
            {voices.error ? (
              <ErrorBox error={voices.error} onRetry={() => void voices.reload()} />
            ) : (
              <div {...stylex.props(s.voiceRow)}>
                <select
                  id={voiceSelectId}
                  value={voiceId ?? ""}
                  disabled={busy || !voices.data}
                  onChange={(e) => update({ voiceId: e.target.value })}
                  {...stylex.props(field.input, field.select)}
                >
                  {!voices.data && <option value={voiceId ?? ""}>{t("common.loading")}</option>}
                  {voices.data?.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
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

          <fieldset {...stylex.props(s.radios)}>
            <legend {...stylex.props(field.label)}>{t("settings.model")}</legend>
            {TTS_MODELS.map((m) => (
              <label key={m} {...stylex.props(field.inline)}>
                <input type="radio" name="tts-model" value={m} checked={model === m} disabled={busy} onChange={() => update({ ttsModel: m })} />
                {t(`settings.model.${m}`)}
              </label>
            ))}
          </fieldset>
          <p {...stylex.props(text.muted, text.small, s.intro)}>{t("settings.costNote")}</p>
        </>
      )}

      <SaveStatus error={error} saved={saved} />
    </section>
  );
}
