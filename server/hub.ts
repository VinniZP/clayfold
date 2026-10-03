import type { TopicEvent } from "../shared/events";

type Listener = (event: TopicEvent) => void;

const listeners = new Map<string, Set<Listener>>();

/** Delivers an event to every open stream of the topic. */
export function publish(topicId: string, event: TopicEvent): void {
  for (const listener of listeners.get(topicId) ?? []) listener(event);
}

export function subscribe(topicId: string, listener: Listener): () => void {
  let set = listeners.get(topicId);
  if (!set) listeners.set(topicId, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(topicId);
  };
}

/** Open topic streams across all topics. */
export function streamCount(): number {
  let count = 0;
  for (const set of listeners.values()) count += set.size;
  return count;
}
