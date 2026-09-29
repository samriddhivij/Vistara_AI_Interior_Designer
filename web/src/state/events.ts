import type { FeedEvent } from "../components/rail/types";

let events: FeedEvent[] = [];
const listeners = new Set<(events: FeedEvent[]) => void>();

let brainFeedLoaded = false;
function ensureBrainFeed() {
  if (!brainFeedLoaded && typeof window !== "undefined") {
    brainFeedLoaded = true;
    import("../components/brainfeed/BrainFeed").catch((err) => {
      console.error("Failed to load BrainFeed dynamically:", err);
    });
  }
}

export function logEvent(e: FeedEvent): void {
  ensureBrainFeed();
  events.push(e);
  if (events.length > 200) {
    events.shift(); // Cap at ~200 events
  }
  const currentEvents = [...events];
  listeners.forEach((cb) => cb(currentEvents));
}

export function subscribe(cb: (events: FeedEvent[]) => void): () => void {
  ensureBrainFeed();
  listeners.add(cb);
  // Call immediately so subscriber gets current events state
  cb([...events]);
  return () => {
    listeners.delete(cb);
  };
}
