import * as stylex from "@stylexjs/stylex";
import { Check, ListChecks, SendHorizontal, Square, TriangleAlert } from "lucide-react";
import { useEffect, useId, useReducer, useRef, useState, type ReactNode } from "react";
import type { ChatMessage, ConversationView } from "@shared/api";
import type { TopicEvent } from "@shared/events";
import { api, errorText } from "../lib/api";
import { useElapsed } from "../lib/elapsed";
import { useOverlayScroll } from "../lib/overlayScroll";
import { formatUsd } from "../lib/format";
import { t, useLang } from "../lib/i18n";
import { useTopicStream } from "../lib/stream";
import { useResource } from "../lib/useResource";
import { color, motion, radius } from "../theme/tokens.stylex";
import { btn, field, layout, readable, text } from "../theme/ui";
import { Clay, ErrorBox, Markdown, Skeleton, type ClayName } from "./ui";

type Msg = ChatMessage;

type State = {
  messages: Msg[];
  running: boolean;
  /** Start of the current run (ISO); null when idle. */
  runningSince: string | null;
  currentActivity: string | null;
  cost: number | null;
  retry: { attempt: number; delayMs: number } | null;
};

type Action =
  | { type: "load"; view: ConversationView }
  | { type: "event"; event: TopicEvent; lessonId: string | null }
  | { type: "local"; message: Msg }
  | { type: "running"; running: boolean };

let localSeq = 0;
const now = () => new Date().toISOString();

/** Past-tense result for a lesson step's activity line, from step.published / step.status. */
function stepResult(messages: Msg[], idx: number, done: string): Msg[] {
  const label = t("activity.stepCheck", { n: idx + 1 });
  const at = messages.findLastIndex((m) => m.role === "activity" && m.text === label);
  if (at === -1) return messages;
  return messages.map((m, i) => (i === at ? { ...m, doneText: done } : m));
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "load":
      return {
        messages: action.view.messages,
        running: action.view.running,
        runningSince: action.view.running ? (action.view.runningSince ?? now()) : null,
        currentActivity: action.view.running ? action.view.currentActivity : null,
        cost: null,
        retry: null,
      };
    case "local":
      return { ...state, messages: [...state.messages, action.message] };
    case "running":
      return {
        ...state,
        running: action.running,
        runningSince: action.running ? (state.runningSince ?? now()) : null,
        currentActivity: action.running ? state.currentActivity : null,
        cost: action.running ? null : state.cost,
      };
    case "event": {
      const e = action.event;
      switch (e.type) {
        case "conv.text": {
          const i = state.messages.findIndex((m) => m.id === e.messageId);
          const messages =
            i === -1
              ? [...state.messages, { id: e.messageId, role: "assistant" as const, text: e.delta, createdAt: now() }]
              : state.messages.map((m, j) => (j === i ? { ...m, text: m.text + e.delta } : m));
          return { ...state, messages, retry: null, running: true, runningSince: state.runningSince ?? now() };
        }
        case "conv.activity":
          return {
            ...state,
            running: true,
            runningSince: state.runningSince ?? now(),
            currentActivity: e.label,
            messages: [...state.messages, { id: `act-${++localSeq}`, role: "activity", text: e.label, doneText: e.doneLabel, createdAt: now() }],
          };
        case "conv.ask":
          return {
            ...state,
            messages: [
              ...state.messages,
              { id: `ask-${++localSeq}`, role: "ask", text: e.question, options: e.options, multi: e.multi, allowFree: e.allowFree, createdAt: now() },
            ],
          };
        case "conv.status":
          return {
            ...state,
            running: e.running,
            runningSince: e.running ? (e.startedAt ?? state.runningSince ?? now()) : null,
            currentActivity: e.running ? state.currentActivity : null,
            cost: e.running ? null : state.cost,
          };
        case "conv.retry":
          return { ...state, retry: { attempt: e.attempt, delayMs: e.delayMs } };
        case "conv.done":
          return {
            ...state,
            running: false,
            runningSince: null,
            currentActivity: null,
            retry: null,
            cost: e.costUsd,
            messages: e.error ? [...state.messages, { id: `err-${++localSeq}`, role: "error", text: e.error, createdAt: now() }] : state.messages,
          };
        case "step.published":
          if (e.lessonId !== action.lessonId) return state;
          return { ...state, messages: stepResult(state.messages, e.step.idx, t("activity.stepPublished", { n: e.step.idx + 1 })) };
        case "step.status":
          if (e.lessonId !== action.lessonId || e.status === "checking") return state;
          return {
            ...state,
            messages: stepResult(state.messages, e.idx, e.status === "rejected" ? t("activity.stepRejected", { n: e.idx + 1 }) : t("activity.stepDropped", { n: e.idx + 1 })),
          };
        default:
          return state;
      }
    }
  }
}

const pulse = stylex.keyframes({
  "0%": { transform: "scale(0.6)", opacity: 0.7 },
  "100%": { transform: "scale(1.7)", opacity: 0 },
});

const s = stylex.create({
  chat: { display: "flex", flexDirection: "column", flexGrow: 1, minHeight: 0, gap: 12 },
  log: { flexGrow: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, paddingBlock: 4, paddingRight: 4, overscrollBehavior: "contain" },
  empty: { marginBlock: "auto", padding: 12 },
  user: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    paddingBlock: 12,
    paddingInline: 16,
    borderRadius: "20px 20px 6px 20px",
    backgroundColor: color.lilacSoft,
    whiteSpace: "pre-wrap",
  },
  assistantRow: { display: "flex", alignItems: "flex-start", gap: 10 },
  avatar: { flexShrink: 0, borderRadius: "50%", backgroundColor: color.surface2 },
  bubble: { minWidth: 0, paddingBlock: 12, paddingInline: 16, borderRadius: "6px 20px 20px 20px", backgroundColor: color.surface2 },
  plain: { minWidth: 0 },
  ask: { display: "grid", gap: 10, padding: 14, borderRadius: radius.inner, backgroundColor: color.surface2 },
  options: { display: "grid", gap: 6 },
  option: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    width: "100%",
    paddingBlock: 11,
    paddingInline: 14,
    textAlign: "left",
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: { default: color.border, ":hover": color.primary, ":disabled": color.border },
    borderRadius: radius.field,
    backgroundColor: color.surface,
    color: color.text,
    opacity: { default: 1, ":disabled": 0.7 },
    cursor: { default: "pointer", ":disabled": "default" },
    transitionProperty: "border-color, background-color",
    transitionDuration: motion.fast,
  },
  optionOn: { borderColor: color.primary, backgroundColor: color.lilacSoft },
  optionLabel: { display: "block", fontWeight: 650 },
  optionDesc: { display: "block", fontSize: 13, color: color.textMuted },
  check: { display: "grid", placeItems: "center", width: 18, height: 18, marginTop: 2, flexShrink: 0, borderWidth: 1.5, borderStyle: "solid", borderColor: color.borderStrong, borderRadius: 5 },
  checkOn: { backgroundColor: color.primary, borderColor: color.primary, color: color.onPrimary },
  start: { justifySelf: "start" },
  comment: { minHeight: 44, fontSize: 14.5 },
  timeline: { borderRadius: radius.field, backgroundColor: color.surface2, fontSize: 13.5 },
  summary: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "4px 10px",
    paddingBlock: 10,
    paddingInline: 14,
    cursor: "pointer",
    listStyle: "none",
    color: color.textMuted,
    "::-webkit-details-marker": { display: "none" },
  },
  summaryTitle: { fontWeight: 700, color: color.text },
  latest: { display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0 },
  okIcon: { flexShrink: 0, color: color.success },
  more: { marginLeft: "auto", fontSize: 12.5, fontWeight: 650, color: color.accentText },
  list: { display: "grid", gap: 6, margin: 0, paddingBlock: "0 12px", paddingInline: 14, listStyle: "none" },
  listItem: { display: "flex", alignItems: "flex-start", gap: 8 },
  listIcon: { flexShrink: 0, marginTop: 3, color: color.success },
  run: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "8px 12px",
    paddingBlock: 9,
    paddingInline: "16px 9px",
    borderRadius: radius.inner,
    backgroundColor: color.lilacSoft,
  },
  runPulse: {
    position: "relative",
    flexShrink: 0,
    width: 10,
    height: 10,
    borderRadius: "50%",
    backgroundColor: color.accentText,
    "::after": {
      content: '""',
      position: "absolute",
      inset: -5,
      borderRadius: "50%",
      borderWidth: 2,
      borderStyle: "solid",
      borderColor: color.accentText,
      opacity: 0,
      animationName: pulse,
      animationDuration: "1.6s",
      animationTimingFunction: motion.ease,
      animationIterationCount: "infinite",
    },
  },
  runLabel: { flexGrow: 1, flexShrink: 1, flexBasis: "13rem", minWidth: 0, fontSize: 14, fontWeight: 650, overflowWrap: "anywhere" },
  runTime: { marginLeft: "auto", fontSize: 13, fontWeight: 650, color: color.accentText, fontVariantNumeric: "tabular-nums" },
  runStop: { backgroundColor: color.surface },
  note: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: color.textMuted },
  error: { display: "flex", alignItems: "center", gap: 6, color: color.danger, fontSize: 14, fontWeight: 500 },
  illustration: { alignSelf: "center", justifySelf: "center", maxWidth: "100%", height: "auto" },
  emptyGroup: { display: "grid", gap: 16, alignContent: "start", marginBlock: 0 },
  composer: {
    display: "flex",
    alignItems: "flex-end",
    gap: 8,
    padding: 6,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: color.border,
    borderRadius: 26,
    backgroundColor: color.surface,
    transitionProperty: "border-color, box-shadow",
    transitionDuration: motion.fast,
  },
  composerFocus: { borderColor: color.focus, boxShadow: `0 0 0 3px ${color.lilacSoft}` },
  textarea: {
    flexGrow: 1,
    minHeight: 44,
    maxHeight: 160,
    paddingBlock: 11,
    paddingInline: "14px 8px",
    borderWidth: 0,
    backgroundColor: "transparent",
    color: color.text,
    resize: "none",
    fieldSizing: "content",
    outline: "none",
  },
});

/** Consecutive activity lines as one "what was done" list, with finished actions in the past tense. */
function ActivityGroup({ items, live }: { items: Msg[]; live: boolean }) {
  useLang();
  // While the run is on, its latest activity is shown in the status row instead.
  const finished = live ? items.slice(0, -1) : items;
  const entries: { label: string; n: number; id: string }[] = [];
  for (const m of finished) {
    const label = m.doneText ?? m.text;
    const prev = entries[entries.length - 1];
    if (prev && prev.label === label) prev.n++;
    else entries.push({ label, n: 1, id: m.id });
  }
  if (entries.length === 0) return null;
  const last = entries[entries.length - 1]!;
  return (
    <details {...stylex.props(s.timeline)}>
      <summary {...stylex.props(s.summary)}>
        <ListChecks size={15} aria-hidden="true" />
        <span {...stylex.props(s.summaryTitle)}>{t("chat.done", { count: finished.length })}</span>
        <span {...stylex.props(s.latest)}>
          <Check size={13} aria-hidden="true" {...stylex.props(s.okIcon)} />
          <span>
            {t("chat.latest", { label: last.label })}
            {last.n > 1 && <span {...stylex.props(text.tnum)}> ×{last.n}</span>}
          </span>
        </span>
        {entries.length > 1 && <span {...stylex.props(s.more, text.tnum)}>{t("chat.all", { count: entries.length })}</span>}
      </summary>
      <ol {...stylex.props(s.list)}>
        {entries.map((e) => (
          <li key={e.id} {...stylex.props(s.listItem)}>
            <Check size={13} aria-hidden="true" {...stylex.props(s.listIcon)} />
            <span>
              {e.label}
              {e.n > 1 && <span {...stylex.props(text.muted, text.tnum)}> ×{e.n}</span>}
            </span>
          </li>
        ))}
      </ol>
    </details>
  );
}

function RunStatus({ label, since, retry, onStop }: { label: string; since: string | null; retry: State["retry"]; onStop: () => void }) {
  useLang();
  const elapsed = useElapsed(since);
  const line = retry ? t("chat.retrying", { seconds: Math.ceil(retry.delayMs / 1000), attempt: retry.attempt }) : label;
  return (
    <div {...stylex.props(s.run)}>
      <span {...stylex.props(s.runPulse)} aria-hidden="true" />
      <span role="status" {...stylex.props(s.runLabel)}>
        {line}
      </span>
      {elapsed && (
        <span aria-hidden="true" {...stylex.props(s.runTime)}>
          {elapsed}
        </span>
      )}
      <button type="button" onClick={onStop} {...stylex.props(btn.base, btn.ghost, btn.sm, s.runStop)}>
        <Square size={12} aria-hidden="true" fill="currentColor" /> {t("chat.stop")}
      </button>
    </div>
  );
}

function AskBlock({ msg, interactive, onAnswer }: { msg: Msg; interactive: boolean; onAnswer: (text: string) => void }) {
  useLang();
  const [picked, setPicked] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const groupId = useId();
  const commentId = useId();
  const options = msg.options ?? [];
  const free = interactive && msg.allowFree !== false;
  const answer = msg.multi ? [picked.join(", "), comment.trim()].filter(Boolean).join("\n\n") : comment.trim();
  return (
    <div {...stylex.props(s.ask)}>
      <div id={groupId}>
        <Markdown src={msg.text} />
      </div>
      {options.length > 0 && (
        <div role="group" aria-labelledby={groupId} {...stylex.props(s.options)}>
          {options.map((o) => {
            const on = picked.includes(o.label);
            return (
              <button
                key={o.label}
                type="button"
                disabled={!interactive}
                aria-pressed={msg.multi ? on : undefined}
                onClick={() => {
                  if (!msg.multi) onAnswer(o.label);
                  else setPicked((p) => (on ? p.filter((x) => x !== o.label) : [...p, o.label]));
                }}
                {...stylex.props(s.option, on && s.optionOn)}
              >
                {msg.multi && (
                  <span aria-hidden="true" {...stylex.props(s.check, on && s.checkOn)}>
                    {on && <Check size={12} />}
                  </span>
                )}
                <span>
                  <span {...stylex.props(s.optionLabel)}>{o.label}</span>
                  {o.description && <span {...stylex.props(s.optionDesc)}>{o.description}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {free && (
        <>
          <label htmlFor={commentId} {...stylex.props(layout.srOnly)}>
            {t(msg.multi ? "chat.comment" : "chat.ownAnswer")}
          </label>
          <textarea
            id={commentId}
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && answer) {
                e.preventDefault();
                onAnswer(answer);
              }
            }}
            placeholder={t(msg.multi ? "chat.comment" : "chat.ownAnswer")}
            {...stylex.props(field.input, field.textarea, s.comment)}
          />
        </>
      )}
      {(msg.multi ? interactive : free) && (
        <button type="button" disabled={!answer} onClick={() => onAnswer(answer)} {...stylex.props(btn.base, btn.primary, btn.sm, s.start)}>
          {t(msg.multi ? "chat.sendSelected" : "chat.sendOwn")}
        </button>
      )}
    </div>
  );
}

/** Claude writes its lead-in after calling ask_learner; show that text above the question it introduces. */
function questionsAfterLeadIn(messages: Msg[]): Msg[] {
  const out = [...messages];
  for (let i = 0; i < out.length; i++) {
    if (out[i]!.role !== "ask") continue;
    let end = i + 1;
    while (end < out.length && out[end]!.role === "assistant") end++;
    if (end > i + 1) {
      out.splice(i, end - i, ...out.slice(i + 1, end), out[i]!);
      i = end - 1;
    }
  }
  return out;
}

type Props = {
  conversationId: string | null;
  topicId: string;
  /** Lesson the conversation authors, so step results can mark its activity lines. */
  lessonId?: string | null;
  /** Replaces the default send (POST /messages); may return the conversation it created. */
  onSend?: (text: string) => Promise<string | void>;
  placeholder?: string;
  empty?: ReactNode;
  label: string;
  /** Tutor presentation: avatar next to replies, an illustration while the chat is short. */
  persona?: { avatar: ClayName; illustration?: ClayName };
  /** Sends `text` once each time `nonce` changes, as if the learner typed it. */
  autoSend?: { text: string; nonce: number } | null;
};

export function Chat({ conversationId, topicId, lessonId = null, onSend, placeholder = t("chat.placeholder"), empty, label, persona, autoSend }: Props) {
  useLang();
  const [state, dispatch] = useReducer(reducer, { messages: [], running: false, runningSince: null, currentActivity: null, cost: null, retry: null });
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [convId, setConvId] = useState(conversationId);
  const [composerFocus, setComposerFocus] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const inputId = useId();
  useOverlayScroll(logRef);

  useEffect(() => setConvId(conversationId), [conversationId]);

  const conv = useResource(() => api.conversation(convId!), convId);
  useEffect(() => {
    if (conv.data) dispatch({ type: "load", view: conv.data });
  }, [conv.data]);
  useEffect(() => {
    if (!convId) dispatch({ type: "load", view: { id: "", topicId, kind: "tutor", running: false, runningSince: null, currentActivity: null, messages: [] } });
  }, [convId, topicId]);

  useTopicStream(
    topicId,
    (event) => {
      const mine = "conversationId" in event && event.conversationId === convId;
      const stepEvent = (event.type === "step.published" || event.type === "step.status") && !!lessonId;
      if (mine || stepEvent) dispatch({ type: "event", event, lessonId });
      // Stored messages carry the server's past-tense results; pick them up once the run ends.
      if (mine && event.type === "conv.done") void conv.reload();
    },
    () => {
      if (convId) void conv.reload();
    },
  );

  useEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [state.messages, state.running]);

  const send = async (body0: string) => {
    const body = body0.trim();
    if (!body) return;
    setSendError(null);
    dispatch({ type: "local", message: { id: `local-${++localSeq}`, role: "user", text: body, createdAt: now() } });
    dispatch({ type: "running", running: true });
    stick.current = true;
    try {
      if (onSend) {
        const created = await onSend(body);
        if (created && created !== convId) setConvId(created);
      } else if (convId) {
        await api.sendMessage(convId, body);
      }
    } catch (err) {
      dispatch({ type: "running", running: false });
      setSendError(errorText(err));
    }
  };

  const sentNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!autoSend || sentNonce.current === autoSend.nonce) return;
    sentNonce.current = autoSend.nonce;
    void send(autoSend.text);
    // `send` reads the latest props through state; only a new nonce should trigger it.
  }, [autoSend]);

  // The tutor often adds a short line after ask_learner, so the open question is the latest ask
  // with no learner message after it, not necessarily the last message.
  const lastAskIdx = state.messages.findLastIndex((m) => m.role === "ask");
  const answered = lastAskIdx >= 0 && state.messages.slice(lastAskIdx + 1).some((m) => m.role === "user");
  const pendingAsk = !state.running && lastAskIdx >= 0 && !answered ? state.messages[lastAskIdx]! : null;
  const freeTextAllowed = !pendingAsk || pendingAsk.allowFree !== false;
  const last = state.messages[state.messages.length - 1];
  const spoken = state.messages.filter((m) => m.role === "user" || m.role === "assistant").length;

  // Group consecutive activity lines into one compact list.
  const blocks: (Msg | Msg[])[] = [];
  for (const m of questionsAfterLeadIn(state.messages)) {
    const prev = blocks[blocks.length - 1];
    if (m.role === "activity" && Array.isArray(prev)) prev.push(m);
    else blocks.push(m.role === "activity" ? [m] : m);
  }

  return (
    <section aria-label={label} {...stylex.props(s.chat)}>
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        {...stylex.props(s.log, readable.surface)}
      >
        {conv.loading && !conv.data && convId ? (
          <Skeleton lines={4} />
        ) : conv.error ? (
          <ErrorBox error={conv.error} onRetry={conv.reload} title={t("chat.loadFailed")} />
        ) : state.messages.length === 0 && !state.running ? (
          <div {...stylex.props(s.empty, persona?.illustration && s.emptyGroup)}>
            {empty}
            {persona?.illustration && <Clay name={persona.illustration} size={200} xstyle={s.illustration} />}
          </div>
        ) : (
          blocks.map((b, i) =>
            Array.isArray(b) ? (
              <ActivityGroup key={b[0]!.id} items={b} live={state.running && i === blocks.length - 1} />
            ) : b.role === "user" ? (
              <div key={b.id} {...stylex.props(s.user)}>
                <p>{b.text}</p>
              </div>
            ) : b.role === "assistant" ? (
              persona ? (
                <div key={b.id} {...stylex.props(s.assistantRow)}>
                  <Clay name={persona.avatar} size={40} xstyle={s.avatar} />
                  <div {...stylex.props(s.bubble)}>
                    <Markdown src={b.text} />
                  </div>
                </div>
              ) : (
                <div key={b.id} {...stylex.props(s.plain)}>
                  <Markdown src={b.text} />
                </div>
              )
            ) : b.role === "ask" ? (
              <AskBlock key={b.id} msg={b} interactive={b === pendingAsk} onAnswer={send} />
            ) : (
              <p key={b.id} role="alert" {...stylex.props(s.error)}>
                <TriangleAlert size={14} aria-hidden="true" /> {b.text}
              </p>
            ),
          )
        )}
        {!state.running && state.cost !== null && (
          <p {...stylex.props(s.note)}>
            <Check size={14} aria-hidden="true" /> {t("chat.doneCost", { cost: formatUsd(state.cost) })}
          </p>
        )}
        {persona?.illustration && spoken > 0 && spoken < 3 && <Clay name={persona.illustration} size={180} xstyle={s.illustration} />}
      </div>

      {state.running && (
        <RunStatus
          label={state.currentActivity ?? (last?.role === "assistant" ? t("chat.writing") : t("chat.thinking"))}
          since={state.runningSince}
          retry={state.retry}
          onStop={() => convId && void api.cancel(convId).catch((err) => setSendError(errorText(err)))}
        />
      )}

      {sendError && (
        <p role="alert" {...stylex.props(s.error)}>
          <TriangleAlert size={14} aria-hidden="true" /> {t("chat.sendFailed", { error: sendError })}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (state.running || !freeTextAllowed) return;
          void send(draft);
          setDraft("");
        }}
        onFocus={() => setComposerFocus(true)}
        onBlur={() => setComposerFocus(false)}
        {...stylex.props(s.composer, composerFocus && s.composerFocus)}
      >
        <label htmlFor={inputId} {...stylex.props(layout.srOnly)}>
          {t("chat.message")}
        </label>
        <textarea
          id={inputId}
          rows={1}
          value={draft}
          disabled={!freeTextAllowed}
          placeholder={freeTextAllowed ? placeholder : t("chat.pickOption")}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          {...stylex.props(s.textarea)}
        />
        <button type="submit" aria-label={t("chat.send")} disabled={!draft.trim() || !freeTextAllowed || state.running} {...stylex.props(btn.base, btn.icon, btn.iconSolid)}>
          <SendHorizontal size={17} aria-hidden="true" />
        </button>
      </form>
      {pendingAsk?.options && pendingAsk.options.length > 0 && (
        <p {...stylex.props(layout.srOnly)}>{t("chat.optionsAbove", { count: pendingAsk.options.length })}</p>
      )}
    </section>
  );
}
