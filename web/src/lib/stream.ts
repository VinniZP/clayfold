import { useEffect, useRef, useSyncExternalStore } from "react";
import type { TopicEvent } from "@shared/events";

/**
 * One EventSource per topic, shared by every subscriber on the page. The stream reconnects
 * with exponential backoff; subscribers get `onReconnect` so they can refetch what they missed.
 */

export type StreamStatus = "connecting" | "open" | "reconnecting";

type Subscriber = { onEvent: (event: TopicEvent) => void; onReconnect?: () => void };

type Stream = {
  topicId: string;
  source: EventSource | null;
  subscribers: Set<Subscriber>;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
  opened: boolean;
  status: StreamStatus;
  listeners: Set<() => void>;
};

const streams = new Map<string, Stream>();

function setStatus(stream: Stream, status: StreamStatus) {
  stream.status = status;
  for (const l of stream.listeners) l();
}

function dispatch(stream: Stream, raw: string) {
  let event: TopicEvent;
  try {
    event = JSON.parse(raw) as TopicEvent;
  } catch {
    return;
  }
  if (!event || typeof event !== "object" || !("type" in event)) return;
  for (const s of [...stream.subscribers]) s.onEvent(event);
}

function connect(stream: Stream) {
  const source = new EventSource(`/api/topics/${encodeURIComponent(stream.topicId)}/stream`);
  stream.source = source;
  source.onopen = () => {
    const reconnected = stream.opened;
    stream.opened = true;
    stream.attempt = 0;
    setStatus(stream, "open");
    if (reconnected) for (const s of [...stream.subscribers]) s.onReconnect?.();
  };
  source.onmessage = (m) => dispatch(stream, m.data);
  source.onerror = () => {
    source.close();
    stream.source = null;
    if (stream.subscribers.size === 0) return;
    setStatus(stream, "reconnecting");
    const delay = Math.min(30_000, 500 * 2 ** stream.attempt) * (0.75 + Math.random() * 0.5);
    stream.attempt++;
    stream.timer = setTimeout(() => {
      stream.timer = null;
      if (stream.subscribers.size > 0) connect(stream);
    }, delay);
  };
}

function acquire(topicId: string): Stream {
  let stream = streams.get(topicId);
  if (!stream) {
    stream = {
      topicId,
      source: null,
      subscribers: new Set(),
      attempt: 0,
      timer: null,
      opened: false,
      status: "connecting",
      listeners: new Set(),
    };
    streams.set(topicId, stream);
    connect(stream);
  }
  return stream;
}

function release(stream: Stream) {
  if (stream.subscribers.size > 0 || stream.listeners.size > 0) return;
  stream.source?.close();
  if (stream.timer) clearTimeout(stream.timer);
  streams.delete(stream.topicId);
}

/** Subscribes to the topic's event stream while mounted. Handlers may change between renders. */
export function useTopicStream(
  topicId: string | null | undefined,
  onEvent: (event: TopicEvent) => void,
  onReconnect?: () => void,
) {
  const handlers = useRef({ onEvent, onReconnect });
  handlers.current = { onEvent, onReconnect };
  useEffect(() => {
    if (!topicId) return;
    const stream = acquire(topicId);
    const sub: Subscriber = {
      onEvent: (e) => handlers.current.onEvent(e),
      onReconnect: () => handlers.current.onReconnect?.(),
    };
    stream.subscribers.add(sub);
    return () => {
      stream.subscribers.delete(sub);
      release(stream);
    };
  }, [topicId]);
}

export function useStreamStatus(topicId: string | null | undefined): StreamStatus | null {
  return useSyncExternalStore(
    (notify) => {
      if (!topicId) return () => {};
      const stream = acquire(topicId);
      stream.listeners.add(notify);
      return () => {
        stream.listeners.delete(notify);
        release(stream);
      };
    },
    () => (topicId ? (streams.get(topicId)?.status ?? "connecting") : null),
  );
}
