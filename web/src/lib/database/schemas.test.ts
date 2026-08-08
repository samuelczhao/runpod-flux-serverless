import { expect, it } from "vitest";
import { processingDreamSchema } from "@/lib/database/schemas";

it("accepts PostgreSQL timestamps with a UTC offset", () => {
  const row = {
    id: "376e377c-0d3f-4411-a257-5db73ca23648",
    user_id: "40911ce1-a4a6-47c4-8409-b782e80a32c4",
    status: "UPLOADED",
    input_mode: "audio",
    transcript: null,
    audio_storage_path: "user/dream/source.ogg",
    audio_mime_type: "audio/ogg",
    audio_upload_expires_at: "2026-08-08T07:31:42.390675+00:00",
    retain_audio: false,
    visual_bible: null,
    plan_hash: null,
    error_code: null,
  };

  expect(processingDreamSchema.parse(row).audio_upload_expires_at).toBe(row.audio_upload_expires_at);
});
