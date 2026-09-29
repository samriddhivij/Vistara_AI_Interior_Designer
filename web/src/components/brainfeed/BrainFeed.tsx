import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { subscribe, logEvent } from "../../state/events";
import type { FeedEvent } from "../rail/types";
import "./brainfeed.css";

// Helper to format arguments to JSON string (truncated)
function formatArgs(args: object): string {
  try {
    const str = JSON.stringify(args);
    if (str.length > 50) {
      return str.substring(0, 47) + "...";
    }
    return str;
  } catch {
    return "{}";
  }
}

// Format relative time as +mm:ss
function formatRelativeTime(currentT: number, firstT: number): string {
  const diffMs = currentT - firstT;
  const totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
  const mm = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const ss = (totalSeconds % 60).toString().padStart(2, "0");
  return `+${mm}:${ss}`;
}

export default function BrainFeed() {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [isOpen, setIsOpen] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Subscribe to event store
  useEffect(() => {
    const unsubscribe = subscribe((updatedEvents) => {
      setEvents(updatedEvents);
    });
    return unsubscribe;
  }, []);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [events]);

  const firstT = events.length > 0 ? events[0].t : 0;

  const handleDemoClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    demoFeed();
  };

  return (
    <div className={`ghar-bf-panel ${isOpen ? "ghar-bf-panel--open" : "ghar-bf-panel--collapsed"}`}>
      <button
        className="ghar-bf-toggle"
        onClick={() => setIsOpen(!isOpen)}
        title={isOpen ? "Collapse Brain Feed" : "Expand Brain Feed"}
        aria-label={isOpen ? "Collapse Brain Feed" : "Expand Brain Feed"}
      >
        {isOpen ? "▶" : "◀"}
      </button>

      <div className="ghar-bf-header">
        <span className="ghar-bf-header-title">Brain Feed</span>
        <button className="ghar-bf-demo-btn" onClick={handleDemoClick}>
          Demo
        </button>
      </div>

      <div className="ghar-bf-events-list" ref={scrollContainerRef}>
        {events.length === 0 ? (
          <div className="ghar-bf-empty">-- NO EVENTS RECORDED --</div>
        ) : (
          events.map((e, index) => {
            const relTime = formatRelativeTime(e.t, firstT);
            let content = "";
            let prefix = "";

            if (e.kind === "observation") {
              prefix = "👁";
              content = e.text;
            } else if (e.kind === "tool_call") {
              prefix = "🔧";
              content = `${e.name}(${formatArgs(e.args)})`;
            } else if (e.kind === "images") {
              prefix = "🖼";
              content = `4 variants · ${e.done} done · ${e.ms}ms`;
            } else if (e.kind === "note") {
              prefix = "📝";
              content = e.text;
            }

            return (
              <div
                key={`${e.t}_${index}`}
                className={`ghar-bf-event-item ghar-bf-event-item--${e.kind}`}
              >
                <div className="ghar-bf-event-meta">
                  <span className="ghar-bf-event-time">{relTime}</span>
                  <span className="ghar-bf-event-kind">{e.kind}</span>
                </div>
                <div className="ghar-bf-event-content">
                  <span className="ghar-bf-event-prefix">{prefix}</span> {content}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export function demoFeed(): void {
  console.log("Starting demoFeed scripted sequence...");
  
  const demoEvents = [
    { kind: "observation" as const, text: "Model initiated observation of the room corner: mid-century modern aesthetic, leather accent chair." },
    { kind: "note" as const, text: "User expressed desire to see a more minimalist design with lighter wood elements." },
    { kind: "tool_call" as const, name: "generate_variants", args: { description: "Minimalist rattan armchair with light wood frame and cream fabric cushion", keyframe_b64: "..." } },
    { kind: "images" as const, batchId: "b_demo_99", done: 0, ms: 500 },
    { kind: "images" as const, batchId: "b_demo_99", done: 2, ms: 2500 },
    { kind: "images" as const, batchId: "b_demo_99", done: 4, ms: 4500 },
    { kind: "tool_call" as const, name: "compile_brief", args: { chosen_variant_slot: 1, style_direction: "minimalist_rattan" } },
    { kind: "note" as const, text: "Generated brief with ₹48,000 estimate. Model updated recommendations." }
  ];

  const delays = [0, 1500, 3500, 4500, 6500, 8500, 10500, 12500];

  demoEvents.forEach((ev, idx) => {
    setTimeout(() => {
      const fullEvent = {
        ...ev,
        t: Date.now()
      };
      logEvent(fullEvent);
    }, delays[idx]);
  });
}

export function mountBrainFeed(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById("ghar-bf-root")) return; // already mounted
  
  const rootEl = document.createElement("div");
  rootEl.id = "ghar-bf-root";
  document.body.appendChild(rootEl);
  
  const root = createRoot(rootEl);
  root.render(<BrainFeed />);
}

if (typeof window !== "undefined") {
  (window as any).demoFeed = demoFeed;
  (window as any).mountBrainFeed = mountBrainFeed;
  
  // Auto-mount on load so it appears on screen automatically
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => mountBrainFeed());
  } else {
    setTimeout(mountBrainFeed, 100);
  }
}
