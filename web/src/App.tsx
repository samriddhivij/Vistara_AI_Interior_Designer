/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import "./App.scss";
import { LiveAPIProvider, useLiveAPIContext } from "./contexts/LiveAPIContext";
import ControlTray from "./components/control-tray/ControlTray";
import cn from "classnames";
import { LiveClientOptions } from "./types";
import { Modality } from "@google/genai";

// Vistara custom imports
import Stage from "./components/stage/Stage";
import BuildPack from "./components/buildpack/BuildPack";
import type { BriefData } from "./components/rail/types";
import {
  tools,
  dispatchToolCall,
  registerKeyframeGrabber,
  setChosenVariantDetails,
  setChosenVariantUrl,
  setOnBatchUpdate,
  logFeedEvent,
  homeSpec,
  upsertHomeArea,
  runTour,
  tourWholeHome,
  compileBuildPack,
  resetHomeSpec,
  type BatchUpdate,
} from "./tools";
import BrainFeed from "./components/brainfeed/BrainFeed";

const API_KEY = process.env.REACT_APP_GEMINI_API_KEY as string;
if (typeof API_KEY !== "string") {
  throw new Error("set REACT_APP_GEMINI_API_KEY in .env");
}

const apiOptions: LiveClientOptions = {
  apiKey: API_KEY,
};

// Module-level stash of the last uploaded room photo (base64 jpeg, no data-url prefix).
// Used as the keyframe fallback when the camera isn't streaming (refurbishment mode).
let uploadedKeyframeB64: string | null = null;

// Session caps: audio-only Live sessions allow 15 minutes; audio+video only 2.
const AUDIO_ONLY_CAP_S = 900;
const VIDEO_CAP_S = 120;

// Minimal fallback persona — used ONLY if fetching /prompts/persona.md fails.
// The real persona (whole-home Asha, verify-at-each-step, tour guide) lives in
// web/public/prompts/persona.md; keep this aligned with its core behavior.
const BUILT_IN_PERSONA = `You are Asha, an interior designer with twelve years in Indian homes, on a live call, helping the user design their DREAM HOME from their description. Identity FIXED; never mention being an AI or tools by name.

VOICE: under 2 sentences per turn, one question per turn, spoken words only (no digits or lists). If interrupted, stop instantly and follow the new topic.

FLOW (verify at each step — never advance without the user's confirmation):
- Open by inviting the dream-home description. When they describe it, silently CALL note_home_spec(description), ask at most TWO clarifying questions (size/budget), then CALL imagine_space for the hero area (living room unless they lead elsewhere).
- Concepts land: ask "which one feels like home?" On a pick: note_home_spec(style), propose the next area, design it via imagine_space with the chosen style. One area at a time.
- Changes to a chosen concept → CALL refine_design with only the changes. Tours: when the user NAMES a room ("show me the kitchen") CALL generate_tour with that area_name; if it isn't designed yet, say so and offer to design it now. Re-touring an unchanged room is instant. While anything generates, narrate your design decisions — never go silent.
- When a tour plays, you are their home tour guide: walk them through it feature by feature. On whole-home tours, transition naturally between rooms ("...and from the living room, into your kitchen").
- Silently CALL note_home_spec whenever the user reveals ANY fact: description, style, area, constraint (east-facing, vaastu, kids), budget, city, or size — one call per fact. This record drives the floor plan and architect report.
- FINISHING: never call compile_brief on your own. You may suggest once: "whenever you're ready, say 'prepare my architect pack' — or hit Finish home." Call it only on an explicit ask.
- If they show a real room (camera/photo upload) → refurbish via generate_variants instead.

INDIA: rupees as spoken ranges, vaastu opt-in, monsoon/climate-aware materials, mirror their language mix. Never fabricate prices or promise exact plans ("a concept plan — your architect makes it exact").`;

function VistaraApp() {
  const { client, setConfig, setModel, connected, connect, disconnect } = useLiveAPIContext();
  const [systemInstruction, setSystemInstruction] = useState(BUILT_IN_PERSONA);

  // Camera plumbing — the <video> element must always exist: the keyframe
  // grabber and ControlTray's webcam wiring both depend on this ref.
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoStream, setVideoStream] = useState<MediaStream | null>(null);

  // Screens & stage state
  const [showBuildPack, setShowBuildPack] = useState(false);
  const [brief, setBrief] = useState<BriefData | null>(null);
  const [planUrl, setPlanUrl] = useState<string | null>(null);
  const [activeVideo, setActiveVideo] = useState<{
    src: string;
    caption: string;
    areaName?: string | null;
  } | null>(null);
  const [chosenConceptUrl, setChosenConceptUrl] = useState<string | null>(null);
  const [activeBatch, setActiveBatch] = useState<BatchUpdate | null>(null);
  const [brainOpen, setBrainOpen] = useState(false);

  // Whole-home tour queue: room names in play order + the current position.
  // Videos render sequentially in tools.tourWholeHome; readyTourVideosRef
  // collects each finished video so the queue can advance the moment the
  // previous one ends (or show "rendering next room…" while it waits).
  const [tourQueue, setTourQueue] = useState<{ names: string[]; current: number } | null>(null);
  const tourQueueRef = useRef<{ names: string[]; current: number } | null>(null);
  const readyTourVideosRef = useRef<Map<string, string>>(new Map());
  const updateTourQueue = useCallback(
    (q: { names: string[]; current: number } | null) => {
      tourQueueRef.current = q;
      setTourQueue(q);
    },
    []
  );

  // homeSpec is a plain module object (not reactive) — bump this counter on
  // every pick/batch-update so the left "Your home so far" gallery re-renders.
  const [galleryVersion, setGalleryVersion] = useState(0);

  // Shared tour entry point: tool dispatcher, gallery ▶ buttons, and the
  // whole-home queue all land here as each walkthrough video becomes ready.
  const handlePlayTour = useCallback(
    (videoUrl: string, areaName: string | null) => {
      const queue = tourQueueRef.current;
      if (queue && areaName) {
        // Part of a whole-home tour: stash the ready video; only play it if
        // it's the room the queue is currently waiting on.
        readyTourVideosRef.current.set(areaName, videoUrl);
        if (queue.names[queue.current] !== areaName) return;
      }
      setActiveVideo({
        src: videoUrl,
        caption: areaName
          ? `${areaName} — your home`
          : "cinematic walkthrough — generated live with Omni Flash just now",
        areaName,
      });
      // Tell the live model the tour is on screen so Asha narrates it (tour-guide role).
      try {
        client.send([{
          text: `[The ${areaName ?? "design"} walkthrough is now playing on screen. Narrate it as the home tour guide: walk them through the space feature by feature — the entry, the light, the furniture — warm and specific, one beat at a time. Then invite edits.]`,
        }]);
      } catch (err) {
        console.warn("[App] Could not nudge model for tour narration:", err);
      }
    },
    [client]
  );

  // A tour video finished (or was dismissed): advance the whole-home queue if
  // one is running — play the next room when its video is ready, otherwise
  // hold with the "rendering next room…" chip until onPlayTour delivers it.
  const handleTourAdvance = useCallback(() => {
    const queue = tourQueueRef.current;
    if (!queue) {
      setActiveVideo(null);
      return;
    }
    const next = queue.current + 1;
    if (next >= queue.names.length) {
      updateTourQueue(null);
      readyTourVideosRef.current.clear();
      setActiveVideo(null);
      return;
    }
    updateTourQueue({ names: queue.names, current: next });
    const nextName = queue.names[next];
    const readyUrl = readyTourVideosRef.current.get(nextName);
    if (readyUrl) {
      setActiveVideo({
        src: readyUrl,
        caption: `${nextName} — your home`,
        areaName: nextName,
      });
    } else {
      setActiveVideo(null); // queue chips show "rendering next room…"
    }
  }, [updateTourQueue]);

  // "▶ Tour whole home": queue every locked room, render sequentially.
  const handleTourWholeHome = useCallback(() => {
    logFeedEvent({ kind: "note", text: "user started the whole-home tour" });
    tourWholeHome(handlePlayTour, (names) => {
      readyTourVideosRef.current.clear();
      updateTourQueue({ names, current: 0 });
    }).catch((err) => console.error("[App] whole-home tour failed:", err));
  }, [handlePlayTour, updateTourQueue]);

  // "✓ Finish home": user-initiated build pack — same pipeline compile_brief uses.
  const handleFinishHome = useCallback(() => {
    logFeedEvent({ kind: "note", text: "user tapped Finish home — compiling build pack" });
    setShowBuildPack(true);
    compileBuildPack({
      onShowBrief: (visible) => setShowBuildPack(visible),
      onSetBrief: (b) => setBrief(b),
      onPlanReady: (url) => setPlanUrl(url),
    });
  }, []);

  // After the user picks from a batch, later poll snapshots for that same
  // batch must not resurrect the grid on stage.
  const dismissedBatchIdRef = useRef<string | null>(null);

  // Hidden file input for the "upload a room photo" refurbishment flow
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // Session countdown: 15 min audio-only; drops to 2 min once the camera is live.
  const [timeLeft, setTimeLeft] = useState(AUDIO_ONLY_CAP_S);

  // 1. Load custom prompts/persona.md dynamically if compiled by Agent A3
  useEffect(() => {
    fetch("/prompts/persona.md")
      .then((res) => {
        if (res.ok) return res.text();
        throw new Error("Persona not found");
      })
      .then((text) => {
        if (text && text.trim().length > 10) {
          console.log("[App] Dynamically loaded custom persona system instruction.");
          setSystemInstruction(text);
        }
      })
      .catch(() => {
        console.log("[App] Using built-in fallback system instruction.");
      });
  }, []);

  // 2. Configure Live API model, system instructions, and tool declarations
  useEffect(() => {
    setModel("models/gemini-3.1-flash-live-preview");
    setConfig({
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } }, // Warm speaking tone
      },
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      tools: tools,
    });
  }, [setConfig, setModel, systemInstruction]);

  // 3. Register Keyframe Grabber
  // Priority: live video frame if the camera is actually streaming (videoWidth > 0),
  // ELSE the last uploaded room photo, ELSE null.
  useEffect(() => {
    registerKeyframeGrabber(() => {
      const video = videoRef.current;
      if (video && video.videoWidth > 0) {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          if (dataUrl.includes(",")) {
            return dataUrl.split(",")[1];
          }
          return dataUrl;
        }
      }
      return uploadedKeyframeB64;
    });
    return () => {
      registerKeyframeGrabber(() => null);
    };
  }, [videoRef]);

  // 4. Listen for tool call dispatch events
  useEffect(() => {
    const onToolCall = (toolCall: any) => {
      console.log("[App] Tool call received:", toolCall);
      if (!toolCall.functionCalls) return;

      for (const fc of toolCall.functionCalls) {
        dispatchToolCall(client, fc, {
          onShowBrief: (visible) => setShowBuildPack(visible),
          onSetBrief: (b) => setBrief(b),
          onPlayVideo: (scene) => {
            // play_scene routes into the Stage too — one consistent screen.
            setActiveVideo({
              src: `/clips/${scene}.mp4`,
              caption: "generated with Omni Flash earlier this session",
            });
          },
          onPlayTour: handlePlayTour,
          onPlanReady: (url) => {
            console.log("[App] Floor plan ready:", url);
            setPlanUrl(url);
          },
        });
      }
    };

    client.on("toolcall", onToolCall);
    return () => {
      client.off("toolcall", onToolCall);
    };
  }, [client, handlePlayTour]);

  // 5. Batch snapshots from tools.ts drive the Stage's 2x2 concept grid.
  useEffect(() => {
    setOnBatchUpdate((batch) => {
      if (batch.batchId === dismissedBatchIdRef.current) return; // already picked
      setActiveBatch(batch);
      setGalleryVersion((v) => v + 1); // homeSpec may have gained areas meanwhile
    });
    return () => {
      setOnBatchUpdate(null);
    };
  }, []);

  // User picked a concept from the stage grid (after the ✓ + zoom animation).
  const handlePick = useCallback(
    (url: string, slot: number) => {
      const areaName = activeBatch?.areaName || "this space";
      console.log("[App] Concept picked:", url, "slot:", slot + 1, "area:", areaName);

      // Feedback the choice to the live model to anchor suggestions
      try {
        client.send([{
          text: `[User picked concept ${slot + 1} for ${areaName}: ${url}. Confirm the pick briefly and propose the next area.]`,
        }]);
      } catch (err) {
        console.warn("[App] Could not nudge model about the pick:", err);
      }

      // Stash the picked URL as the chosen design for generate_tour / refine_design
      setChosenVariantUrl(url);
      // ...and show it big on the central Stage with the "locked in" chip
      setChosenConceptUrl(url);

      // Record it in the whole-home spec so the left gallery shows it per area
      upsertHomeArea(areaName, url, "locked");

      // Stash design information dynamically based on which slot is chosen
      let description = "contemporary style redesign";
      let objects = ["armchair", "curtains"];
      if (slot === 0) {
        description = "redesign in a warm minimal style with natural materials";
        objects = ["warm minimalist wooden armchair", "natural jute rug", "linen curtains", "subtle floor lamp"];
      } else if (slot === 1) {
        description = "redesign in a contemporary Indian style with cane and block-print textiles";
        objects = ["cane armchair", "block-print curtains", "terracotta pots", "brass lamp"];
      } else if (slot === 2) {
        description = "redesign in a bold color-forward style";
        objects = ["teal accent armchair", "vibrant ochre curtains", "colorful abstract rug", "potted monstera"];
      } else if (slot === 3) {
        description = "redesign in a budget-friendly style using affordable materials";
        objects = ["affordable fabric lounge chair", "bamboo blinds", "cotton rug", "hanging planters"];
      }
      setChosenVariantDetails(description, objects);

      logFeedEvent({
        kind: "note",
        text: `user locked in concept ${slot + 1} for ${areaName}`,
      });

      // Clear the grid — the chosen concept takes the stage until the next batch
      dismissedBatchIdRef.current = activeBatch?.batchId ?? null;
      setActiveBatch(null);
      setGalleryVersion((v) => v + 1);
    },
    [client, activeBatch]
  );

  // 6. Session cap countdown — 15 min audio-only, tightened to 2 min while the
  // camera streams (audio+video sessions have the shorter Live cap). The
  // countdown always runs and auto-disconnects at 0; the display only appears
  // in camera (FIX-IT) mode so the default flow has no scary timer.
  useEffect(() => {
    let intervalId: any = null;
    if (connected) {
      if (videoStream) {
        setTimeLeft((prev) => Math.min(prev, VIDEO_CAP_S));
      }
      intervalId = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(intervalId);
            disconnect();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      setTimeLeft(AUDIO_ONLY_CAP_S);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [connected, videoStream, disconnect]);

  // 7. Reconnect handler (<10 seconds teardown & setup)
  const handleReconnect = useCallback(async () => {
    console.log("[App] One-tap Reconnecting session...");
    await disconnect();
    setTimeout(async () => {
      await connect();
    }, 300);
  }, [connect, disconnect]);

  // 8. Room photo upload (refurbishment mode) — downscale to max 1024 long edge,
  // stash as the keyframe fallback, and tell the model about it.
  const handlePhotoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-uploading the same file
    if (!file) return;

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const longEdge = Math.max(img.width, img.height);
      const scale = longEdge > 1024 ? 1024 / longEdge : 1;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      uploadedKeyframeB64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
      console.log("[App] Room photo uploaded and stashed as keyframe fallback.");

      // Give the live model context about the uploaded room
      if (connected) {
        client.send([{
          text: "[User uploaded a photo of a room they want refurbished. Treat it as the room under discussion.]"
        }]);
      }
      logFeedEvent({
        kind: "observation",
        text: "User uploaded a room photo — refurbishment mode keyframe ready.",
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      console.error("[App] Failed to load uploaded photo.");
    };
    img.src = objectUrl;
  }, [client, connected]);

  // 9. Typed prompt bar — sends text into the same live session (voice optional)
  const [promptText, setPromptText] = useState("");
  const handleSendPrompt = useCallback(() => {
    const text = promptText.trim();
    if (!text || !connected) return;
    client.send([{ text }]);
    logFeedEvent({ kind: "observation", text: `User typed: ${text.slice(0, 80)}` });
    setPromptText("");
  }, [promptText, connected, client]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const galleryAreas = homeSpec.areas.filter((a) => a.imageUrl);
  const lockedAreas = galleryAreas.filter((a) => a.status === "locked");
  const tourBusy = tourQueue !== null;

  return (
    <div className="ghar-shell">
      {/* ---- LEFT (desktop): "Your home so far" — chosen concept per area ---- */}
      <aside className="ghar-gallery" data-version={galleryVersion}>
        <div className="ghar-gallery-header">
          <div className="ghar-gallery-title">Your home so far</div>
          {galleryAreas.length >= 1 && (
            <button
              className="ghar-gallery-tour-all"
              onClick={handleTourWholeHome}
              disabled={tourBusy || lockedAreas.length === 0}
              title={
                lockedAreas.length === 0
                  ? "Lock in at least one room first"
                  : "Play a walkthrough of every locked room"
              }
            >
              ▶ Tour whole home
            </button>
          )}
        </div>
        {galleryAreas.length === 0 ? (
          <div className="ghar-gallery-empty">
            Picked concepts land here, area by area.
          </div>
        ) : (
          galleryAreas.map((area) => (
            <div
              key={area.name}
              className="ghar-gallery-card"
              role="button"
              tabIndex={0}
              onClick={() => setChosenConceptUrl(area.imageUrl)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setChosenConceptUrl(area.imageUrl);
              }}
              title={`Review ${area.name} on stage`}
            >
              <img src={area.imageUrl} alt={area.name} />
              <button
                className="ghar-gallery-card-tour"
                onClick={(e) => {
                  e.stopPropagation();
                  logFeedEvent({ kind: "note", text: `user started a tour of ${area.name} from the gallery` });
                  runTour(area.imageUrl, area.name, undefined, handlePlayTour).catch(
                    (err) => console.error("[App] gallery tour failed:", err)
                  );
                }}
                title={`Tour ${area.name}`}
                aria-label={`Tour ${area.name}`}
              >
                ▶
              </button>
              <div className="ghar-gallery-card-label">
                <span className="ghar-gallery-card-name">{area.name}</span>
                <span className="ghar-gallery-card-check">✓</span>
              </div>
            </div>
          ))
        )}
        {galleryAreas.length >= 1 && (
          <button
            className="ghar-gallery-reset"
            onClick={() => {
              if (window.confirm("Start over? This clears your saved home design.")) {
                resetHomeSpec();
                window.location.reload();
              }
            }}
            title="Clear the saved home design and start fresh"
          >
            ↺ reset home
          </button>
        )}
      </aside>

      {/* ---- CENTER: the design journey ---- */}
      <div className="ghar-main">
        {/* ---- Slim top bar: wordmark | timer + reconnect + connect ---- */}
        <header className="ghar-topbar">
          <div className="ghar-wordmark">Vistara</div>
          <div className="ghar-topbar-right">
            {homeSpec.areas.length >= 1 && (
              <button
                className="ghar-topbar-btn ghar-finish-btn"
                onClick={handleFinishHome}
                title="Compile your floor plan, budget and approvals into the build pack"
              >
                ✓ Finish home
              </button>
            )}
            {connected && (
              <>
                {videoStream && (
                  <span className={cn("ghar-timer", { warning: timeLeft < 30 })}>
                    {formatTime(timeLeft)}
                  </span>
                )}
                <button className="ghar-topbar-btn" onClick={handleReconnect}>
                  🔄 Reconnect
                </button>
              </>
            )}
            <button
              className={cn("ghar-topbar-btn ghar-connect-btn", { connected })}
              onClick={connected ? disconnect : connect}
            >
              {connected ? "⏸ End" : "▶ Start"}
            </button>
          </div>
        </header>

        {/* ---- Whole-home tour queue: room progress chips above the stage ---- */}
        {tourQueue && (
          <div className="ghar-tour-queue">
            {tourQueue.names.map((roomName, i) => (
              <span
                key={roomName}
                className={cn("ghar-tour-queue-chip", {
                  current: i === tourQueue.current,
                  played: i < tourQueue.current,
                })}
              >
                {i <= tourQueue.current ? "●" : "○"} {roomName}
              </span>
            ))}
            {!activeVideo && (
              <span className="ghar-tour-queue-chip rendering">
                rendering next room…
              </span>
            )}
          </div>
        )}

        {/* ---- Central stage: tour video > concept grid > locked pick > camera > idle ---- */}
        <div className="ghar-stage-area">
          {/* Camera video sits BEHIND the stage; visible only in FIX-IT (camera) mode.
              Must always exist: keyframe grabber + ControlTray depend on the ref. */}
          <video
            className={cn("ghar-camera", { hidden: !videoStream })}
            ref={videoRef}
            autoPlay
            playsInline
          />
          <Stage
            tourVideo={activeVideo}
            conceptUrl={chosenConceptUrl}
            cameraActive={!!videoStream}
            batch={activeBatch}
            onPick={handlePick}
            onVideoEnded={handleTourAdvance}
            onCloseTour={handleTourAdvance}
          />
        </div>

        {/* ---- Typed prompt bar: same live session as voice ---- */}
        <div className={cn("ghar-prompt-bar", { disabled: !connected })}>
          <input
            type="text"
            className="ghar-prompt-input"
            placeholder={
              connected
                ? "Describe your dream home… e.g. 3BHK, modern techy vibe, one room as a gym"
                : "Press ▶ Start first, then type or talk"
            }
            value={promptText}
            disabled={!connected}
            onChange={(e) => setPromptText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSendPrompt();
            }}
          />
          <button
            className="ghar-prompt-send"
            disabled={!connected || !promptText.trim()}
            onClick={handleSendPrompt}
          >
            ➤
          </button>
        </div>

        {/* ---- Bottom: mic controls (audio streaming + keyframe wiring live here) ---- */}
        <ControlTray
          videoRef={videoRef}
          supportsVideo={true}
          onVideoStreamChange={setVideoStream}
          enableEditingSettings={false}
        />

        {/* Room photo upload (FIX-IT entry) — keyframe fallback when the camera is off */}
        <button
          className="ghar-upload-btn"
          onClick={() => uploadInputRef.current?.click()}
        >
          📷 Upload a room photo
        </button>
        <input
          ref={uploadInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={handlePhotoUpload}
        />

        {/* Mobile only: thinking feed as a collapsible drawer (desktop shows the
            permanent right panel instead — toggle + drawer are hidden ≥900px) */}
        <button
          className="ghar-brain-toggle"
          onClick={() => setBrainOpen((o) => !o)}
          aria-label="Toggle Asha's thinking"
          title="Asha's thinking"
        >
          🧠
        </button>
        <div className={cn("ghar-brain-drawer", { open: brainOpen })}>
          <BrainFeed />
        </div>
      </div>

      {/* ---- RIGHT (desktop): Asha's thinking — always-visible process panel ---- */}
      <aside className="ghar-thinking-panel">
        <div className="ghar-thinking-header">Asha's thinking</div>
        <BrainFeed />
      </aside>

      {/* Final deliverable: floor plan + report */}
      <BuildPack
        brief={brief}
        planUrl={planUrl}
        visible={showBuildPack}
        onClose={() => setShowBuildPack(false)}
      />
    </div>
  );
}

function App() {
  return (
    <div className="App">
      <LiveAPIProvider options={apiOptions}>
        <VistaraApp />
      </LiveAPIProvider>
    </div>
  );
}

export default App;
