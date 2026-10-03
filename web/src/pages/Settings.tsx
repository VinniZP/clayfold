import * as stylex from "@stylexjs/stylex";
import { Check, KeyRound, Play } from "lucide-react";
import { useId, useRef, useState } from "react";
import { TTS_MODELS, type Settings, type SettingsUpdate } from "@shared/api";
import { useHeader } from "../components/header";
import { CardHead, ErrorBox, PageLoading, Spinner } from "../components/ui";
import { api, errorText } from "../lib/api";
import { t, useLang } from "../lib/i18n";
import { useResource } from "../lib/useResource";
import { card, btn, chip, field, layout, text } from "../theme/ui";

const s = stylex.create({
  card: { display: "grid", gap: 20, maxWidth: 760 },
  intro: { maxWidth: "62ch" },
  keyRow: { display: "flex", gap: 8, flexWrap: "wrap", maxWidth: 560 },
  keyInput: { flex: "1 1 260px" },
  voiceRow: { display: "flex", gap: 8, alignItems: "center", maxWidth: 560 },
  radios: { display: "grid", gap: 8, margin: 0, padding: 0, borderWidth: 0 },
});

export function SettingsPage() {
  useLang();
  useHeader({ title: t("settings.title") });
  const settings = useResource(() => api.settings(), "settings");
  if (settings.error && !settings.data) return <ErrorBox error={settings.error} onRetry={() => void settings.reload()} />;
  if (!settings.data) return <PageLoading />;
  return <NarrationSettings settings={settings.data} onChange={(next) => settings.setData(() => next)} />;
}

function NarrationSettings({ settings, onChange }: { settings: Settings; onChange: (next: Settings) => void }) {
  useLang();
  const { keySet, voiceId, model } = settings.narration;
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const voices = useResource(() => api.voices(), keySet ? "voices" : null);
  const sample = useRef<HTMLAudioElement | null>(null);
  const keyId = useId();
  const voiceSelectId = useId();

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

      {error && (
        <p role="alert" {...stylex.props(text.error)}>
          {error}
        </p>
      )}
      {saved && !error && (
        <p role="status" {...stylex.props(text.saved)}>
          <Check size={16} aria-hidden="true" /> {t("settings.saved")}
        </p>
      )}
    </section>
  );
}
