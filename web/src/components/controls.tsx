import * as stylex from "@stylexjs/stylex";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { bp, color, motion, radius } from "../theme/tokens.stylex";

// Form controls drawn in the app's style: a switch, a segmented choice and a select with a listbox.

const s = stylex.create({
  switchRow: { display: "inline-flex", alignItems: "center", gap: 12, cursor: { default: "pointer", ":has(button:disabled)": "not-allowed" } },
  track: {
    position: "relative",
    flexShrink: 0,
    width: 46,
    height: 28,
    padding: 0,
    borderWidth: 0,
    borderRadius: radius.pill,
    backgroundColor: color.surface3,
    cursor: { default: "pointer", ":disabled": "not-allowed" },
    opacity: { default: 1, ":disabled": 0.5 },
    transitionProperty: "background-color",
    transitionDuration: motion.base,
    outlineOffset: 3,
  },
  trackOn: { backgroundColor: color.primary },
  knob: {
    position: "absolute",
    top: 3,
    left: 3,
    width: 22,
    height: 22,
    borderRadius: "50%",
    backgroundColor: color.surface,
    boxShadow: `0 2px 4px ${color.shadowStrong}`,
    transitionProperty: "transform",
    transitionDuration: { default: motion.base, [bp.reduce]: "0s" },
    transitionTimingFunction: motion.ease,
  },
  knobOn: { transform: "translateX(18px)" },
  switchLabel: { fontSize: 15, fontWeight: 600 },

  segmented: { display: "inline-flex", flexWrap: "wrap", gap: 4, padding: 4, borderRadius: radius.field, backgroundColor: color.surface2 },
  segment: {
    display: "grid",
    gap: 2,
    minWidth: 120,
    paddingBlock: 8,
    paddingInline: 14,
    borderWidth: 0,
    borderRadius: radius.small,
    backgroundColor: { default: "transparent", ":hover": color.surface3 },
    color: color.text,
    textAlign: "left",
    cursor: { default: "pointer", ":disabled": "not-allowed" },
    transitionProperty: "background-color, box-shadow",
    transitionDuration: motion.fast,
  },
  segmentOn: { backgroundColor: { default: color.surface, ":hover": color.surface }, boxShadow: `0 1px 3px ${color.shadowStrong}` },
  segmentLabel: { fontSize: 14, fontWeight: 650 },
  segmentHint: { fontSize: 12, color: color.textMuted },

  select: { position: "relative", minWidth: 0 },
  trigger: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    minHeight: 42,
    paddingBlock: 8,
    paddingInline: 14,
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: { default: color.border, ":hover": color.borderStrong },
    borderRadius: radius.field,
    backgroundColor: { default: color.surface, ":disabled": color.surface2 },
    color: color.text,
    fontSize: 14.5,
    textAlign: "left",
    cursor: { default: "pointer", ":disabled": "not-allowed" },
    opacity: { default: 1, ":disabled": 0.6 },
  },
  triggerOpen: { borderColor: color.focus, boxShadow: `0 0 0 3px ${color.lilacSoft}` },
  value: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  placeholder: { color: color.textMuted },
  chevron: { flexShrink: 0, color: color.textMuted, transitionProperty: "transform", transitionDuration: motion.fast },
  chevronOpen: { transform: "rotate(180deg)" },
  list: {
    position: "absolute",
    zIndex: 50,
    top: "calc(100% + 6px)",
    left: 0,
    minWidth: "100%",
    maxHeight: 280,
    overflowY: "auto",
    margin: 0,
    padding: 6,
    listStyle: "none",
    borderRadius: radius.field,
    backgroundColor: color.surface,
    boxShadow: `0 4px 10px ${color.shadow}, 0 24px 48px -16px ${color.shadowStrong}`,
  },
  option: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingBlock: 8,
    paddingInline: 10,
    borderRadius: radius.small,
    fontSize: 14.5,
    whiteSpace: "nowrap",
    cursor: "pointer",
  },
  optionActive: { backgroundColor: color.lilacSoft },
  optionCheck: { width: 16, flexShrink: 0, color: color.accentText },
});

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <span {...stylex.props(s.switchRow)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        {...stylex.props(s.track, checked && s.trackOn)}
      >
        <span aria-hidden="true" {...stylex.props(s.knob, checked && s.knobOn)} />
      </button>
      <span id={id} onClick={() => !disabled && onChange(!checked)} {...stylex.props(s.switchLabel)}>
        {label}
      </span>
    </span>
  );
}

export type Choice<T extends string> = { value: T; label: string; hint?: string };

/** One choice out of a few, all visible: a radio group drawn as segments; arrow keys move the choice. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
}: {
  value: T;
  options: Choice<T>[];
  onChange: (next: T) => void;
  label: string;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} {...stylex.props(s.segmented)}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => void (refs.current[i] = el)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => onKey(e, i)}
          {...stylex.props(s.segment, o.value === value && s.segmentOn)}
        >
          <span {...stylex.props(s.segmentLabel)}>{o.label}</span>
          {o.hint && <span {...stylex.props(s.segmentHint)}>{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

/**
 * A select as a button and a listbox: arrow keys, Home and End move, Enter or Space picks, Escape and a click
 * outside close it, and typing a letter jumps to the next option that starts with it.
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled,
  placeholder,
}: {
  value: T | null;
  options: Choice<T>[];
  onChange: (next: T) => void;
  label: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);

  const show = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const pick = (i: number) => {
    const o = options[i];
    if (o) onChange(o.value);
    setOpen(false);
    trigger.current?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    const last = options.length - 1;
    const move: Record<string, () => number> = {
      ArrowDown: () => Math.min(active + 1, last),
      ArrowUp: () => Math.max(active - 1, 0),
      Home: () => 0,
      End: () => last,
    };
    if (move[e.key]) {
      e.preventDefault();
      setActive(move[e.key]!());
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
    } else if (e.key.length === 1) {
      const letter = e.key.toLowerCase();
      const order = [...options.slice(active + 1), ...options.slice(0, active + 1)];
      const hit = order.find((o) => o.label.toLowerCase().startsWith(letter));
      if (hit) setActive(options.indexOf(hit));
    }
  };

  return (
    <div ref={root} {...stylex.props(s.select)}>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        {...stylex.props(s.trigger, open && s.triggerOpen)}
      >
        <span {...stylex.props(s.value, !current && s.placeholder)}>{current?.label ?? placeholder ?? ""}</span>
        <ChevronDown size={16} aria-hidden="true" {...stylex.props(s.chevron, open && s.chevronOpen)} />
      </button>
      {open && (
        <ul id={listId} role="listbox" aria-label={label} {...stylex.props(s.list)}>
          {options.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={o.value === value}
              onPointerEnter={() => setActive(i)}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => pick(i)}
              {...stylex.props(s.option, i === active && s.optionActive)}
            >
              <span {...stylex.props(s.optionCheck)}>{o.value === value && <Check size={16} aria-hidden="true" />}</span>
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
