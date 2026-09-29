import { FunctionDeclaration, Tool, Type } from "@google/genai";
import { USE_MOCK, mockFetchBrief, mockPollVariants } from "./components/rail/mockServer";
import type { FeedEvent, BriefData, VariantSlot } from "./components/rail/types";
import { logEvent } from "./state/events";

// ---------------------------------------------------------------- Constants & Env

const SERVER_URL = process.env.REACT_APP_SERVER_URL || "http://localhost:8000";

// ---------------------------------------------------------------- Module-level State

let getLatestKeyframeB64: (() => string | null) = () => null;
let chosenVariantDescription = "replace the armchair with a rattan chair, warm minimal style";
let chosenVariantObjects: string[] = ["rattan armchair", "curtains", "plants"];
let chosenVariantUrl: string | null = null; // explicit tap on a rail tile
let latestVariantUrl: string | null = null; // fallback: first "done" image of the latest batch
let firstEventTime: number | null = null;

// ---------------------------------------------------------------- Setup Helpers

export function registerKeyframeGrabber(grabber: () => string | null) {
  getLatestKeyframeB64 = grabber;
}

export function setChosenVariantDetails(description: string, objects: string[]) {
  chosenVariantDescription = description;
  chosenVariantObjects = objects;
}

/** Called from App's onVariantChosen with the full URL of the tapped tile. */
export function setChosenVariantUrl(url: string) {
  chosenVariantUrl = url;
}

/** Auto-stashed from the variants polling loop — fallback "chosen" for the tour. */
export function setLatestVariantUrl(url: string) {
  latestVariantUrl = url;
}

// ---------------------------------------------------------------- Batch → Stage wiring

/** Lightweight batch snapshot pushed to the Stage (replaces the old rail path). */
export interface BatchUpdate {
  batchId: string;
  areaName: string;
  slots: VariantSlot[]; // always 4; urls are FULL loadable URLs
}

/** App registers a listener here; runVariantsBatch pushes snapshots into it. */
export let onBatchUpdate: ((batch: BatchUpdate) => void) | null = null;

export function setOnBatchUpdate(cb: ((batch: BatchUpdate) => void) | null) {
  onBatchUpdate = cb;
}

/** "/static/x.jpg" → SERVER_URL + path; absolute URLs (mock) pass through. */
function toFullUrl(u: string): string {
  if (/^https?:\/\//.test(u)) return u;
  const base = SERVER_URL.replace(/\/$/, "");
  return base + (u.startsWith("/") ? u : "/" + u);
}

/** Short display label for the batch header: first 4 words of the description. */
function batchAreaLabel(description: string): string {
  const words = description.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "your space";
  return words.slice(0, 4).join(" ");
}

const PENDING_SLOTS: VariantSlot[] = [0, 1, 2, 3].map((slot) => ({
  slot,
  status: "pending" as const,
  url: null,
}));

// ---------------------------------------------------------------- Home Spec (whole-home design state)

/** One designed area/room of the home. */
export interface HomeArea {
  name: string;
  status: "designing" | "locked";
  imageUrl: string;
  /** Cached walkthrough video for this area's CURRENT imageUrl (cleared on redesign). */
  tourVideoUrl: string | null;
  /** Refinement history — every refine_design description applied to this area. */
  designNotes: string[];
}

/** The central structured home specification — persisted, reused by every feature. */
export interface HomeSpec {
  version: 1;
  createdAt: number;
  updatedAt: number;
  description: string;
  city: string | null;
  sizeSqft: string | null;
  budgetInr: string | null;
  style: string | null;
  constraints: string[];
  areas: HomeArea[];
}

const HOME_SPEC_STORAGE_KEY = "ghar_home_spec";

function createEmptyHomeSpec(): HomeSpec {
  const now = Date.now();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    description: "",
    city: null,
    sizeSqft: null,
    budgetInr: null,
    style: null,
    constraints: [],
    areas: [],
  };
}

/** The evolving whole-home specification, silently recorded via note_home_spec. */
export const homeSpec: HomeSpec = createEmptyHomeSpec();

// Restore a previously persisted spec on module load (guarded + version-checked).
(() => {
  try {
    const raw = localStorage.getItem(HOME_SPEC_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === 1 && Array.isArray(parsed.areas)) {
      Object.assign(homeSpec, parsed);
      console.log("[tools] Restored home spec from localStorage:", homeSpec.areas.length, "areas");
    }
  } catch (err) {
    console.warn("[tools] Could not restore persisted home spec:", err);
  }
})();

/** Single write path: bump updatedAt + persist. Call after EVERY spec mutation. */
export function saveHomeSpec() {
  homeSpec.updatedAt = Date.now();
  try {
    localStorage.setItem(HOME_SPEC_STORAGE_KEY, JSON.stringify(homeSpec));
  } catch (err) {
    console.warn("[tools] Could not persist home spec:", err);
  }
}

/** Wipe the persisted spec and reset the in-memory object to empty. */
export function resetHomeSpec() {
  try {
    localStorage.removeItem(HOME_SPEC_STORAGE_KEY);
  } catch {
    /* storage unavailable — nothing to clear */
  }
  Object.assign(homeSpec, createEmptyHomeSpec());
}

export function setHomeDescription(description: string) {
  homeSpec.description = description;
  saveHomeSpec();
}

export function setHomeStyle(style: string) {
  homeSpec.style = style;
  saveHomeSpec();
}

/**
 * Push a new area, or update an existing one (matched by name). A changed
 * imageUrl invalidates the area's cached tour video (the design changed).
 */
export function upsertHomeArea(
  name: string,
  imageUrl: string,
  status?: "designing" | "locked"
) {
  const existing = homeSpec.areas.find((a) => a.name === name);
  if (existing) {
    if (imageUrl && existing.imageUrl !== imageUrl) {
      existing.imageUrl = imageUrl;
      existing.tourVideoUrl = null; // stale walkthrough — regenerate on next tour
    }
    if (status) existing.status = status;
  } else {
    homeSpec.areas.push({
      name,
      status: status ?? "designing",
      imageUrl,
      tourVideoUrl: null,
      designNotes: [],
    });
  }
  saveHomeSpec();
}

/**
 * Record a refinement on the area currently being designed.
 * Heuristic (simplest reliable): the LAST area still in "designing" status;
 * else the area whose imageUrl matches the concept being refined; else the
 * most recently added area.
 */
function noteRefinementOnCurrentArea(description: string, refinedImageUrl: string | null) {
  if (homeSpec.areas.length === 0 || !description) return;
  let target = [...homeSpec.areas].reverse().find((a) => a.status === "designing");
  if (!target && refinedImageUrl) {
    target = homeSpec.areas.find((a) => a.imageUrl === refinedImageUrl);
  }
  if (!target) target = homeSpec.areas[homeSpec.areas.length - 1];
  target.designNotes.push(description);
  saveHomeSpec();
}

/**
 * Compose the /brief (+ /plan) request payload from the full home spec —
 * description, style, city/size/budget, constraints, and per-area status +
 * refinement notes — so the server sees the complete design context.
 */
export function buildBriefPayload(): {
  description: string;
  objects: string[];
  home_description?: string;
  rooms?: string[];
  budget_inr?: string;
} {
  const lines: string[] = [];
  if (homeSpec.description) lines.push(homeSpec.description);
  if (homeSpec.style) lines.push(`Style: ${homeSpec.style}`);
  if (homeSpec.city) lines.push(`City: ${homeSpec.city}`);
  if (homeSpec.sizeSqft) lines.push(`Size: ${homeSpec.sizeSqft}`);
  if (homeSpec.budgetInr) lines.push(`Budget: ${homeSpec.budgetInr}`);
  if (homeSpec.constraints.length > 0) {
    lines.push(`Constraints: ${homeSpec.constraints.join("; ")}`);
  }
  for (const a of homeSpec.areas) {
    lines.push(
      `${a.name}: ${a.status}${a.designNotes.length > 0 ? `, notes: ${a.designNotes.join("; ")}` : ""}`
    );
  }

  const payload: {
    description: string;
    objects: string[];
    home_description?: string;
    rooms?: string[];
    budget_inr?: string;
  } = {
    description: chosenVariantDescription || homeSpec.style || "whole-home design",
    objects: chosenVariantObjects,
  };
  if (lines.length > 0) payload.home_description = lines.join("\n");
  if (homeSpec.areas.length > 0) payload.rooms = homeSpec.areas.map((a) => a.name);
  if (homeSpec.budgetInr) payload.budget_inr = homeSpec.budgetInr;
  return payload;
}

export function getElapsedTime(): number {
  if (firstEventTime === null) {
    firstEventTime = Date.now();
  }
  return Date.now() - firstEventTime;
}

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

export function logFeedEvent(event: DistributiveOmit<FeedEvent, "t">) {
  const t = getElapsedTime();
  const fullEvent = { ...event, t } as FeedEvent;
  
  try {
    logEvent(fullEvent);
  } catch (err) {
    console.warn("[tools] logEvent failed:", err);
  }
}

// ---------------------------------------------------------------- Tool Declarations

export const generateVariantsDeclaration: FunctionDeclaration = {
  name: "generate_variants",
  description: "Generate 4 redesign variants of what the camera currently sees. Call this whenever the conversation has produced a concrete design direction — do not ask permission, just call it.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      description: {
        type: Type.STRING,
        description: "One-sentence design direction, e.g. 'replace the armchair with a rattan chair, warm neutral palette, keep everything else identical'"
      }
    },
    required: ["description"]
  }
};

export const playSceneDeclaration: FunctionDeclaration = {
  name: "play_scene",
  description: "Play a cinematic video of the currently selected design. Call when the user asks to see the room 'in the evening', 'at golden hour', 'in the monsoon', or 'living in it'.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      scene: {
        type: Type.STRING,
        description: "The scene/time-of-day cinematic overlay to display",
        enum: ["evening", "monsoon"]
      }
    },
    required: ["scene"]
  }
};

export const compileBriefDeclaration: FunctionDeclaration = {
  name: "compile_brief",
  description: "Compile the architect brief for the current design: itemized rupee budget with vendor links and the legal/society-approval checklist. Call when the user asks to 'send this to my architect', asks about total cost, or asks what approvals they need.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
    required: []
  }
};

export const imagineSpaceDeclaration: FunctionDeclaration = {
  name: "imagine_space",
  description: "Design a space from pure imagination — no camera needed. Call when the user DESCRIBES a room they want created from scratch (a new empty flat, a dream bedroom, a cafe concept) rather than showing one. Produces 4 concept options on the rail.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      description: {
        type: Type.STRING,
        description: "One-sentence description of the imagined space including its style, e.g. 'a sunlit reading nook in a Bengaluru flat, cane furniture, warm neutral palette'"
      }
    },
    required: ["description"]
  }
};

export const refineDesignDeclaration: FunctionDeclaration = {
  name: "refine_design",
  description: "Refine the currently selected design concept while keeping its identity — same room, same layout, only the requested changes. Call when the user asks to CHANGE something about a concept they've already seen ('make the walls warmer', 'swap the chair', 'less wood, more plants'). Produces 4 refined options on the rail.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      description: {
        type: Type.STRING,
        description: "One-sentence description of ONLY the changes to apply, e.g. 'make the walls a warmer terracotta and add a second reading lamp, keep everything else identical'"
      }
    },
    required: ["description"]
  }
};

export const generateTourDeclaration: FunctionDeclaration = {
  name: "generate_tour",
  description: "Create or UPDATE the cinematic video walkthrough of a designed room. Call when the user asks to 'walk me through it', 'give me a tour', 'show me a video of the space' — and call it AGAIN after refinements when they want to re-tour the updated design. Call with area_name when the user names a room.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      instruction: {
        type: Type.STRING,
        description: "OPTIONAL extra camera/mood instruction for this tour, e.g. 'evening, lamps on' or 'slow orbit around the reading chair'. Omit for the default walkthrough."
      },
      area_name: {
        type: Type.STRING,
        description: "Name of the room/area to tour, e.g. 'kitchen', 'master bedroom'. Must match an area the user has already designed. Omit to tour the currently selected concept."
      }
    },
    required: []
  }
};

export const noteHomeSpecDeclaration: FunctionDeclaration = {
  name: "note_home_spec",
  description: "Silently record the evolving home specification. Call whenever the user reveals or decides something about the home: overall description, chosen style, or a specific area/room being designed. Never mention this tool.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      field: {
        type: Type.STRING,
        description: "Which part of the home spec is being recorded — one of: description|style|area|constraint|budget|city|size"
      },
      value: {
        type: Type.STRING,
        description: "The value to record: the overall home description, the chosen style, an area/room detail, a hard constraint (e.g. 'vaastu-compliant entrance'), the budget, the city, or the home size"
      },
      area_name: {
        type: Type.STRING,
        description: "OPTIONAL name of the area/room. Required when field=area, e.g. 'primary bedroom', 'gym room'."
      }
    },
    required: ["field", "value"]
  }
};

// Complete session config tools array
export const tools: Tool[] = [
  { googleSearch: {} },
  {
    functionDeclarations: [
      generateVariantsDeclaration,
      playSceneDeclaration,
      compileBriefDeclaration,
      imagineSpaceDeclaration,
      refineDesignDeclaration,
      generateTourDeclaration,
      noteHomeSpecDeclaration
    ]
  }
];

// ---------------------------------------------------------------- Shared Variants Pipeline

/**
 * Kick off a variants batch (POST /variants → push snapshots to the Stage via
 * onBatchUpdate → poll for the "images" feed event). `keyframe_b64` is OPTIONAL
 * per the server contract — omitting it means from-scratch generation
 * (imagine_space).
 */
async function runVariantsBatch(description: string, keyframe_b64: string | null) {
  const t0 = Date.now();
  const areaName = batchAreaLabel(description);

  if (USE_MOCK) {
    const mockBatchId = `mock-${Date.now()}`;
    console.log("[tools] USE_MOCK is true. Spawning mock batch:", mockBatchId);
    onBatchUpdate?.({ batchId: mockBatchId, areaName, slots: PENDING_SLOTS });

    // Poll the mock lifecycle so the Stage grid fills progressively.
    let stashedFirstDone = false;
    const mockIntervalId = setInterval(async () => {
      const res = await mockPollVariants(mockBatchId);
      const slots = res.images.map((s) => ({
        ...s,
        url: s.url ? toFullUrl(s.url) : null,
      }));
      if (!stashedFirstDone) {
        const firstDone = slots.find((s) => s.status === "done" && s.url);
        if (firstDone && firstDone.url) {
          stashedFirstDone = true;
          setLatestVariantUrl(firstDone.url);
        }
      }
      onBatchUpdate?.({ batchId: mockBatchId, areaName, slots });
      if (slots.every((s) => s.status !== "pending")) {
        clearInterval(mockIntervalId);
      }
    }, 1000);

    // Log complete images event in 6 seconds (to mirror the mock fill duration)
    setTimeout(() => {
      logFeedEvent({
        kind: "images",
        batchId: mockBatchId,
        done: 4,
        ms: Date.now() - t0,
      });
    }, 6000);
    return;
  }

  const body: { description: string; keyframe_b64?: string } = { description };
  if (keyframe_b64) {
    body.keyframe_b64 = keyframe_b64;
  }

  console.log("[tools] Posting variants fetch to:", `${SERVER_URL}/variants`);
  const res = await fetch(`${SERVER_URL}/variants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`HTTP error ${res.status}`);
  }

  const { batch_id } = await res.json();
  console.log("[tools] Batch initiated successfully:", batch_id);

  // Show the pending 2x2 grid on the Stage immediately.
  onBatchUpdate?.({ batchId: batch_id, areaName, slots: PENDING_SLOTS });

  // Track progressive image status polling to fire the logger's "images" event on finality
  const pollStart = Date.now();
  let stashedFirstDone = false;
  const intervalId = setInterval(async () => {
    try {
      const pollRes = await fetch(`${SERVER_URL}/variants/${batch_id}`);
      if (pollRes.ok) {
        const pollData = await pollRes.json();
        const images = pollData.images || [];
        const doneCount = images.filter((img: any) => img.status === "done").length;
        const pendingCount = images.filter((img: any) => img.status === "pending").length;

        // Auto-stash the FIRST done image of this (the latest) batch as the
        // fallback "chosen" design for generate_tour.
        if (!stashedFirstDone) {
          const firstDone = images.find((img: any) => img.status === "done" && img.url);
          if (firstDone) {
            stashedFirstDone = true;
            setLatestVariantUrl(firstDone.url);
          }
        }

        // Push the fresh slot states (with loadable full URLs) to the Stage grid.
        const slots: VariantSlot[] = [0, 1, 2, 3].map((slotIdx) => {
          const img = images.find((i: any) => i.slot === slotIdx);
          return {
            slot: slotIdx,
            status: (img?.status ?? "pending") as VariantSlot["status"],
            url: img?.url ? toFullUrl(img.url) : null,
          };
        });
        onBatchUpdate?.({ batchId: batch_id, areaName, slots });

        // Stop polling if complete, or if we hit a 45s safety timeout
        if (pendingCount === 0 || Date.now() - pollStart > 45000) {
          clearInterval(intervalId);
          logFeedEvent({
            kind: "images",
            batchId: batch_id,
            done: doneCount,
            ms: Date.now() - t0,
          });
        }
      }
    } catch (err) {
      console.error("[tools] Polling error in background logging:", err);
    }
  }, 2000);
}

// ---------------------------------------------------------------- Tour Pipeline

/**
 * adhoc imageUrl -> rendered walkthrough videoUrl, for tours of images that
 * are NOT a named home area. Named areas cache on area.tourVideoUrl in the
 * persisted homeSpec instead (invalidated when the area's imageUrl changes).
 */
const tourCache = new Map<string, string>();

/** Resolve a previously rendered tour: homeSpec area first, then the adhoc map. */
function getCachedTour(imageUrl: string, areaName: string | null): string | null {
  if (areaName) {
    const area = homeSpec.areas.find((a) => a.name === areaName);
    if (area && area.imageUrl === imageUrl && area.tourVideoUrl) {
      return area.tourVideoUrl;
    }
  }
  return tourCache.get(imageUrl) ?? null;
}

/** Stash a rendered tour: onto the persisted area when named, else the adhoc map. */
function setCachedTour(imageUrl: string, areaName: string | null, videoUrl: string) {
  if (areaName) {
    const area = homeSpec.areas.find((a) => a.name === areaName);
    if (area && area.imageUrl === imageUrl) {
      area.tourVideoUrl = videoUrl;
      saveHomeSpec();
      return;
    }
  }
  tourCache.set(imageUrl, videoUrl);
}

/**
 * Render (or replay from cache) a cinematic walkthrough of one design image.
 * On success calls onPlayTour(videoUrl, areaName) and resolves with the
 * videoUrl; resolves null on failure/timeout.
 */
export async function runTour(
  imageUrl: string,
  areaName: string | null,
  instruction: string | undefined,
  onPlayTour: (videoUrl: string, areaName: string | null) => void
): Promise<string | null> {
  // Cache hit — replay instantly (only for default, uninstructed tours).
  if (!instruction) {
    const cached = getCachedTour(imageUrl, areaName);
    if (cached) {
      onPlayTour(cached, areaName);
      return cached;
    }
  }

  const t0 = Date.now();
  try {
    // Build the /tour request body: server-local images go by path, external ones by b64
    let body: { image_url?: string; image_b64?: string; instruction?: string };
    if (imageUrl.startsWith(SERVER_URL) || imageUrl.startsWith("/static")) {
      const path = imageUrl.startsWith(SERVER_URL)
        ? imageUrl.slice(SERVER_URL.replace(/\/$/, "").length)
        : imageUrl;
      body = { image_url: path.startsWith("/") ? path : "/" + path };
    } else {
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) {
        throw new Error(`Failed to fetch chosen variant image: HTTP ${imgRes.status}`);
      }
      const blob = await imgRes.blob();
      const image_b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const dataUrl = reader.result as string;
          resolve(dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      body = { image_b64 };
    }

    if (instruction) {
      body.instruction = instruction;
    }

    console.log("[tools] Posting tour request to:", `${SERVER_URL}/tour`);
    const res = await fetch(`${SERVER_URL}/tour`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
    }
    const { job_id } = await res.json();
    console.log("[tools] Tour job initiated:", job_id);

    // Poll GET /tour/{job_id} every 3s until done/failed/3-min timeout
    return await new Promise<string | null>((resolve) => {
      const pollStart = Date.now();
      const intervalId = setInterval(async () => {
        try {
          if (Date.now() - pollStart > 180000) {
            clearInterval(intervalId);
            console.error("[tools] runTour: polling timed out after 3 minutes.");
            resolve(null);
            return;
          }
          const pollRes = await fetch(`${SERVER_URL}/tour/${job_id}`);
          if (!pollRes.ok) return; // transient — keep polling
          const pollData = await pollRes.json();
          if (pollData.status === "done" && pollData.video_url) {
            clearInterval(intervalId);
            const videoUrl = /^https?:\/\//.test(pollData.video_url)
              ? pollData.video_url
              : SERVER_URL.replace(/\/$/, "") + pollData.video_url;
            if (!instruction) {
              setCachedTour(imageUrl, areaName, videoUrl);
            }
            onPlayTour(videoUrl, areaName);
            logFeedEvent({
              kind: "images",
              batchId: `tour-${job_id}`,
              done: 1,
              ms: Date.now() - t0,
            });
            resolve(videoUrl);
          } else if (pollData.status === "failed") {
            clearInterval(intervalId);
            console.error("[tools] runTour: server reported the tour job failed.");
            resolve(null);
          }
        } catch (err) {
          console.error("[tools] Polling error in tour job:", err);
        }
      }, 3000);
    });
  } catch (err) {
    console.error("[tools] runTour failed:", err);
    return null;
  }
}

/**
 * Tour every LOCKED area of the home, SEQUENTIALLY (one render at a time —
 * the per-area tourVideoUrl cache makes repeat rooms instant). onQueue fires
 * first with the room names in order; onPlayTour fires per area as each
 * video becomes ready.
 */
export async function tourWholeHome(
  onPlayTour: (videoUrl: string, areaName: string | null) => void,
  onQueue: (names: string[]) => void
): Promise<void> {
  const areas = homeSpec.areas.filter((a) => a.status === "locked" && a.imageUrl);
  if (areas.length === 0) return;
  onQueue(areas.map((a) => a.name));
  for (const area of areas) {
    await runTour(area.imageUrl, area.name, undefined, onPlayTour);
  }
}

// ---------------------------------------------------------------- Build Pack Pipeline

/**
 * Compile the architect build pack: POST /brief (budget, rooms, legal) and, in
 * parallel, kick the /plan floor-plan render. Shared by the compile_brief tool
 * dispatcher and the user-initiated "Finish home" button.
 */
export function compileBuildPack(callbacks: {
  onShowBrief: (visible: boolean) => void;
  onSetBrief: (brief: BriefData | null) => void;
  onPlanReady: (planUrl: string) => void;
}) {
  // Compile architect brief asynchronously
  (async () => {
    try {
      callbacks.onShowBrief(true);
      callbacks.onSetBrief(null); // Triggers "Compiling brief…" skeleton state

      let brief: BriefData;
      if (USE_MOCK) {
        brief = await mockFetchBrief();
      } else {
        const briefBody = buildBriefPayload();
        console.log("[tools] Fetching brief from server for:", briefBody.description);
        const res = await fetch(`${SERVER_URL}/brief`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(briefBody),
        });

        if (!res.ok) {
          throw new Error(`HTTP error ${res.status}`);
        }
        brief = await res.json();
      }
      callbacks.onSetBrief(brief);
    } catch (err) {
      console.error("[tools] compileBuildPack brief task failed:", err);
    }
  })();

  // In parallel: kick off the floor-plan render when we know the home
  if (!USE_MOCK && homeSpec.description) {
    (async () => {
      try {
        console.log("[tools] Posting plan request to:", `${SERVER_URL}/plan`);
        const res = await fetch(`${SERVER_URL}/plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            // The composed spec (style, city/size/budget, constraints, per-area
            // notes) gives the plan renderer the full picture of the home.
            home_description: buildBriefPayload().home_description || homeSpec.description,
          }),
        });
        if (!res.ok) {
          throw new Error(`HTTP error ${res.status}`);
        }
        const { job_id } = await res.json();
        console.log("[tools] Plan job initiated:", job_id);

        // Poll GET /plan/{job_id} every 3s until done/failed/3-min timeout
        const pollStart = Date.now();
        const intervalId = setInterval(async () => {
          try {
            if (Date.now() - pollStart > 180000) {
              clearInterval(intervalId);
              console.error("[tools] compileBuildPack: plan polling timed out after 3 minutes.");
              return;
            }
            const pollRes = await fetch(`${SERVER_URL}/plan/${job_id}`);
            if (!pollRes.ok) return; // transient — keep polling
            const pollData = await pollRes.json();
            if (pollData.status === "done" && pollData.image_url) {
              clearInterval(intervalId);
              const planUrl = /^https?:\/\//.test(pollData.image_url)
                ? pollData.image_url
                : SERVER_URL.replace(/\/$/, "") + pollData.image_url;
              callbacks.onPlanReady(planUrl);
            } else if (pollData.status === "failed") {
              clearInterval(intervalId);
              console.error("[tools] compileBuildPack: server reported the plan job failed.");
            }
          } catch (err) {
            console.error("[tools] Polling error in plan job:", err);
          }
        }, 3000);
      } catch (err) {
        console.error("[tools] compileBuildPack plan kickoff failed:", err);
      }
    })();
  }
}

// ---------------------------------------------------------------- Tool Dispatcher

export async function dispatchToolCall(
  client: any,
  fc: { id: string; name: string; args: any },
  callbacks: {
    onShowBrief: (visible: boolean) => void;
    onSetBrief: (brief: BriefData | null) => void;
    onPlayVideo: (scene: "evening" | "monsoon") => void;
    onPlayTour: (videoUrl: string, areaName: string | null) => void;
    onPlanReady: (planUrl: string) => void;
  }
) {
  const { id, name, args } = fc;

  // Log the tool call immediately to feed the brain-feed store
  logFeedEvent({
    kind: "tool_call",
    name,
    args: args || {},
  });

  if (name === "generate_variants") {
    const description = args.description || "";
    
    // ⚠ CRITICAL: Send Tool Response IMMEDIATELY so the conversational model never stalls
    client.sendToolResponse({
      functionResponses: [
        {
          id,
          name,
          response: {
            result: `Generating 4 design options for "${description}" now. They'll stream onto your bottom rail shortly. Let's keep talking!`,
          },
        },
      ],
    });

    // Run the actual image-edit pipeline asynchronously
    (async () => {
      try {
        if (USE_MOCK) {
          await runVariantsBatch(description, null);
          return;
        }
        const keyframe_b64 = getLatestKeyframeB64();
        if (!keyframe_b64) {
          console.error("[tools] No camera keyframe captured yet!");
          return;
        }
        await runVariantsBatch(description, keyframe_b64);
      } catch (err) {
        console.error("[tools] generate_variants async task failed:", err);
      }
    })();

  } else if (name === "imagine_space") {
    const description = args.description || "";

    // ⚠ CRITICAL: Send Tool Response IMMEDIATELY so the conversational model never stalls
    client.sendToolResponse({
      functionResponses: [
        {
          id,
          name,
          response: {
            result: "Sketching four concepts of that space now — they'll appear on your rail. Keep talking to me!",
          },
        },
      ],
    });

    // From-scratch generation: same pipeline, NO keyframe_b64
    (async () => {
      try {
        await runVariantsBatch(description, null);
      } catch (err) {
        console.error("[tools] imagine_space async task failed:", err);
      }
    })();

  } else if (name === "refine_design") {
    const description = args.description || "";

    // ⚠ CRITICAL: Send Tool Response IMMEDIATELY so the conversational model never stalls
    client.sendToolResponse({
      functionResponses: [
        {
          id,
          name,
          response: {
            result: "Refining that design now — same space, just your changes. Watch the rail.",
          },
        },
      ],
    });

    // Edit the currently selected concept image (identity-preserving server edit path)
    (async () => {
      try {
        const imageUrl = chosenVariantUrl || latestVariantUrl;
        if (!imageUrl) {
          console.error("[tools] refine_design: no chosen or generated variant image available yet.");
          return;
        }

        // Record the refinement in the current area's design history
        noteRefinementOnCurrentArea(description, imageUrl);

        // Fetch the image (prefix SERVER_URL for relative /static paths) and b64-encode it
        const fetchUrl = /^https?:\/\//.test(imageUrl)
          ? imageUrl
          : SERVER_URL.replace(/\/$/, "") + (imageUrl.startsWith("/") ? imageUrl : "/" + imageUrl);
        const imgRes = await fetch(fetchUrl);
        if (!imgRes.ok) {
          throw new Error(`Failed to fetch chosen variant image: HTTP ${imgRes.status}`);
        }
        const blob = await imgRes.blob();
        const image_b64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = reader.result as string;
            resolve(dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl);
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        // The server edit path preserves identity — same room, only the asked-for changes.
        await runVariantsBatch(description, image_b64);
      } catch (err) {
        console.error("[tools] refine_design async task failed:", err);
      }
    })();

  } else if (name === "note_home_spec") {
    const field = args.field || "";
    const value = args.value || "";

    if (field === "description") {
      setHomeDescription(value);
    } else if (field === "style") {
      setHomeStyle(value);
    } else if (field === "area") {
      const areaName = args.area_name || value;
      upsertHomeArea(areaName, latestVariantUrl || chosenVariantUrl || "", "designing");
    } else if (field === "constraint") {
      if (value && !homeSpec.constraints.includes(value)) {
        homeSpec.constraints.push(value);
      }
      saveHomeSpec();
    } else if (field === "budget") {
      homeSpec.budgetInr = value || null;
      saveHomeSpec();
    } else if (field === "city") {
      homeSpec.city = value || null;
      saveHomeSpec();
    } else if (field === "size") {
      homeSpec.sizeSqft = value || null;
      saveHomeSpec();
    } else {
      console.warn("[tools] note_home_spec: unknown field:", field);
    }

    client.sendToolResponse({
      functionResponses: [
        {
          id,
          name,
          response: { result: "ok" },
        },
      ],
    });

    logFeedEvent({
      kind: "note",
      text: `home spec — ${field}: ${value}${field === "area" && args.area_name ? ` (${args.area_name})` : ""}`,
    });

  } else if (name === "generate_tour") {
    // Area-aware image resolution: a NAMED area's locked image wins, else the
    // explicitly tapped concept, else the latest generated variant.
    const requestedArea: string = (args && typeof args.area_name === "string" ? args.area_name : "").trim();
    let matchedArea: HomeArea | undefined;
    if (requestedArea) {
      const q = requestedArea.toLowerCase();
      matchedArea = homeSpec.areas.find(
        (a) =>
          a.imageUrl &&
          (a.name.toLowerCase().includes(q) || q.includes(a.name.toLowerCase()))
      );
      if (!matchedArea) {
        // Named a room we haven't designed — tell the model instead of touring the wrong one.
        client.sendToolResponse({
          functionResponses: [
            {
              id,
              name,
              response: {
                result: `I don't have a locked design for ${requestedArea} yet — let's design it first.`,
              },
            },
          ],
        });
        return;
      }
    }

    const imageUrl = matchedArea?.imageUrl || chosenVariantUrl || latestVariantUrl;
    if (!imageUrl) {
      client.sendToolResponse({
        functionResponses: [
          {
            id,
            name,
            response: {
              result: "There's no design to tour yet — let's create a concept first.",
            },
          },
        ],
      });
      return;
    }

    // ⚠ CRITICAL: Send Tool Response IMMEDIATELY so the conversational model never stalls
    client.sendToolResponse({
      functionResponses: [
        {
          id,
          name,
          response: {
            result: `Rendering the walkthrough of ${matchedArea ? matchedArea.name : "your design"} — this can take a minute or two, so let's keep refining while it builds.`,
          },
        },
      ],
    });

    // Kick off the tour render + poll asynchronously (cache-aware)
    const instruction =
      args && typeof args.instruction === "string" && args.instruction
        ? args.instruction
        : undefined;
    runTour(imageUrl, matchedArea ? matchedArea.name : null, instruction, callbacks.onPlayTour).catch(
      (err) => console.error("[tools] generate_tour async task failed:", err)
    );

  } else if (name === "play_scene") {
    const scene = args.scene as "evening" | "monsoon";

    // Immediate confirmation reply
    client.sendToolResponse({
      functionResponses: [
        {
          id,
          name,
          response: {
            result: `Let me show you how this looks in the ${scene}... I'm loading the cinematic view now.`,
          },
        },
      ],
    });

    // Fire video trigger overlay
    callbacks.onPlayVideo(scene);

  } else if (name === "compile_brief") {
    // Immediate confirmation reply
    client.sendToolResponse({
      functionResponses: [
        {
          id,
          name,
          response: {
            result: "I am preparing the brief for your architect now. One moment.",
          },
        },
      ],
    });

    // Same pipeline the "Finish home" button uses — brief + parallel floor plan.
    compileBuildPack(callbacks);
  }
}
