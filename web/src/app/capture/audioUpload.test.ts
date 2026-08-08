import { afterEach, expect, it, vi } from "vitest";
import { uploadDreamRecording } from "@/app/capture/audioUpload";
import type {
  AudioUpload,
  DreamRecorder,
  RecorderPhase,
  UploadAttempt,
} from "@/app/capture/useDreamRecorder";

const storageMocks = vi.hoisted(() => ({ uploadToSignedUrl: vi.fn() }));

vi.mock("@/lib/supabase/browser", () => ({
  createSupabaseBrowserClient: () => ({
    storage: { from: () => ({ uploadToSignedUrl: storageMocks.uploadToSignedUrl }) },
  }),
}));

const DREAM_ID = "238ee925-bb33-4a95-b08b-4b27847c9061";
const OPERATION_ID = "cb780578-a32e-4776-9c6a-dd67e5e99b2d";
const PATH = `user/${DREAM_ID}/source.webm`;
const UPLOAD: AudioUpload = { dreamId: DREAM_ID, path: PATH, token: "old-token" };

afterEach(() => {
  vi.unstubAllGlobals();
  storageMocks.uploadToSignedUrl.mockReset();
});

it("completes a committed upload without writing the blob again", async () => {
    const harness = createRecorderHarness({ upload: UPLOAD, attempted: true, stored: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
    await uploadDreamRecording(harness.recorder, harness.onComplete);
    expect(harness.completedDreamId).toBe(DREAM_ID);
    expect(storageMocks.uploadToSignedUrl).not.toHaveBeenCalled();
});

it("gets a fresh token only after completion proves the object is absent", async () => {
    const harness = createRecorderHarness({ upload: UPLOAD, attempted: true, stored: false });
    const fresh = { ...UPLOAD, token: "fresh-token" };
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(Response.json(fresh, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 })));
    storageMocks.uploadToSignedUrl.mockResolvedValue({ error: null });
    await uploadDreamRecording(harness.recorder, harness.onComplete);
    expect(storageMocks.uploadToSignedUrl).toHaveBeenCalledOnce();
    expect(storageMocks.uploadToSignedUrl).toHaveBeenCalledWith(
      PATH, "fresh-token", harness.recorder.blob, { contentType: "audio/webm" },
    );
    expect(harness.completedDreamId).toBe(DREAM_ID);
});

it("does not overwrite audio when completion verification is unavailable", async () => {
    const harness = createRecorderHarness({ upload: UPLOAD, attempted: true, stored: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
    await uploadDreamRecording(harness.recorder, harness.onComplete);
    expect(storageMocks.uploadToSignedUrl).not.toHaveBeenCalled();
    expect(harness.error).toContain("could not be uploaded");
    expect(harness.phase).toBe("recorded");
});

interface RecorderHarness {
  readonly recorder: DreamRecorder;
  readonly onComplete: (dreamId: string) => void;
  readonly completedDreamId: string | null;
  readonly error: string | null;
  readonly phase: RecorderPhase;
}

function createRecorderHarness(initialAttempt: UploadAttempt): RecorderHarness {
  let attempt: UploadAttempt | null = initialAttempt;
  let phase: RecorderPhase = "recorded";
  let error: string | null = null;
  let completedDreamId: string | null = null;
  const recorder = createRecorder(
    () => attempt, (value) => { attempt = value; },
    (value) => { phase = value; }, (value) => { error = value; },
  );
  return {
    recorder, onComplete: (value) => { completedDreamId = value; },
    get completedDreamId() { return completedDreamId; },
    get error() { return error; }, get phase() { return phase; },
  };
}

function createRecorder(
  getAttempt: () => UploadAttempt | null,
  setAttempt: (attempt: UploadAttempt) => void,
  setPhase: (phase: RecorderPhase) => void,
  setError: (error: string) => void,
): DreamRecorder {
  const blob = new Blob(["dream audio"], { type: "audio/webm" });
  return {
    get phase() { return "recorded" as const; }, seconds: 1, blob, audioUrl: null, error: null,
    get uploadAttempt() { return getAttempt(); }, uploadOperationId: OPERATION_ID,
    start: vi.fn(), stop: vi.fn(), reset: vi.fn(), setUploading: () => setPhase("uploading"),
    setRecorded: () => setPhase("recorded"),
    rememberUpload: (upload) => setAttempt({ upload, attempted: false, stored: false }),
    markUploadAttempted: () => updateAttempt(getAttempt, setAttempt, "attempted"),
    markUploadStored: () => updateAttempt(getAttempt, setAttempt, "stored"), setError,
    isMounted: () => true,
  };
}

function updateAttempt(
  getAttempt: () => UploadAttempt | null,
  setAttempt: (attempt: UploadAttempt) => void,
  field: "attempted" | "stored",
): void {
  const attempt = getAttempt();
  if (attempt) setAttempt({ ...attempt, [field]: true });
}
