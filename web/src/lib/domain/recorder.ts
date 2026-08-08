export function stopMediaStream(stream: Pick<MediaStream, "getTracks">): void {
  stream.getTracks().forEach((track) => track.stop());
}

export function disposeMediaRecorder(recorder: MediaRecorder | null): void {
  if (!recorder) return;
  recorder.ondataavailable = null;
  recorder.onstop = null;
  if (recorder.state !== "inactive") recorder.stop();
  stopMediaStream(recorder.stream);
}

export function createRecordingBlob(chunks: readonly Blob[], mimeType: string): Blob | null {
  const recording = new Blob([...chunks], { type: mimeType });
  return recording.size > 0 ? recording : null;
}
