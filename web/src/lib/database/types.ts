export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type DreamStatus =
  | "DRAFT" | "UPLOADED" | "TRANSCRIBING" | "PLANNING"
  | "GENERATING_ANCHOR" | "GENERATING_SCENES" | "READY" | "FAILED" | "DELETING";
export type JobStatus =
  | "PENDING" | "SUBMITTING" | "SUBMIT_UNKNOWN" | "QUEUED"
  | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED";

type DreamRow = {
  id: string;
  user_id: string;
  status: DreamStatus;
  input_mode: string;
  transcript: string | null;
  raw_transcript: string | null;
  audio_storage_path: string | null;
  audio_mime_type: string | null;
  audio_size_bytes: number | null;
  audio_uploaded_at: string | null;
  audio_operation_key: string | null;
  audio_upload_expires_at: string | null;
  audio_cleanup_run_id: string | null;
  audio_cleanup_claim_token: string | null;
  audio_cleanup_claimed_at: string | null;
  title: string | null;
  summary: string | null;
  visual_bible: string | null;
  workflow_run_id: string | null;
  failed_stage: string | null;
  error_code: string | null;
  retain_audio: boolean;
  plan_hash: string | null;
  mood: string[];
  created_at: string;
  updated_at: string;
}

type SceneRow = {
  id: string;
  dream_id: string;
  ordinal: number;
  caption: string;
  prompt: string;
}

type SceneVersionRow = {
  id: string;
  scene_id: string;
  parent_version_id: string | null;
  storage_path: string | null;
  edit_instruction: string | null;
  seed: number | null;
  model: string;
  status: JobStatus;
  is_selected: boolean;
  operation_key: string | null;
  request_hash: string | null;
  workflow_run_id: string | null;
  workflow_claim_token: string | null;
  workflow_claimed_at: string | null;
  created_at: string;
}

type MotifRow = {
  id: string;
  user_id: string;
  canonical_label: string;
  slug: string;
  kind: "person" | "place" | "object" | "emotion" | "theme";
}

type DreamMotifRow = {
  dream_id: string;
  motif_id: string;
}

type JobRow = {
  id: string;
  user_id: string;
  dream_id: string;
  scene_version_id: string | null;
  stage: string;
  operation_key: string;
  provider: string;
  model: string;
  endpoint_id: string | null;
  external_job_id: string | null;
  status: JobStatus;
  request_hash: string;
  attempt: number;
  delay_ms: number | null;
  execution_ms: number | null;
  cost_usd: string | null;
  cost_source: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

type DreamInsert = {
  user_id: string;
  input_mode: string;
  transcript?: string | null;
  mood?: string[];
  status?: DreamStatus;
  retain_audio?: boolean;
}

type SceneVersionInsert = {
  scene_id: string;
  model: string;
  seed?: number | null;
  parent_version_id?: string | null;
  edit_instruction?: string | null;
  status?: JobStatus;
}

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type VoidFunction<Args> = { Args: Args; Returns: undefined };

export type Database = {
  public: {
    Tables: {
      dreams: Table<DreamRow, DreamInsert>;
      scenes: Table<SceneRow>;
      scene_versions: Table<SceneVersionRow, SceneVersionInsert>;
      motifs: Table<MotifRow>;
      dream_motifs: Table<DreamMotifRow>;
      generation_jobs: Table<JobRow>;
    };
    Views: Record<never, never>;
    Functions: {
      transition_dream_state: VoidFunction<{
        p_dream_id: string;
        p_expected: DreamStatus;
        p_next: DreamStatus;
        p_failed_stage?: string | null;
        p_error_code?: string | null;
      }>;
      complete_dream_plan: VoidFunction<{
        p_job_id: string;
        p_plan: Json;
        p_plan_hash: string;
        p_cost_usd: string | null;
        p_cost_source: "provider" | "estimated" | "unavailable";
        p_delay_ms?: number | null;
        p_execution_ms?: number | null;
      }>;
      claim_dream_workflow: {
        Args: { p_dream_id: string; p_user_id: string; p_claim_token: string };
        Returns: { workflow_id: string; claimed: boolean }[];
      };
      record_dream_workflow: VoidFunction<{
        p_dream_id: string; p_claim_token: string; p_run_id: string;
      }>;
      release_dream_workflow_claim: VoidFunction<{ p_dream_id: string; p_claim_token: string }>;
      complete_audio_upload: VoidFunction<{
        p_dream_id: string;
        p_user_id: string;
        p_storage_path: string;
        p_mime_type: string;
        p_size_bytes: number;
      }>;
      complete_transcription_job: VoidFunction<{
        p_job_id: string;
        p_transcript: string;
        p_delay_ms?: number | null;
        p_execution_ms?: number | null;
      }>;
      claim_audio_plan_workflow: {
        Args: { p_dream_id: string; p_user_id: string; p_transcript: string; p_claim_token: string };
        Returns: { workflow_id: string; claimed: boolean }[];
      };
      mark_audio_deleted: VoidFunction<{ p_dream_id: string; p_storage_path: string }>;
      prepare_audio_deletion: { Args: { p_dream_id: string }; Returns: string | null };
      prepare_audio_dream: {
        Args: { p_user_id: string; p_operation_key: string; p_mime_type: string };
        Returns: string;
      };
      claim_audio_cleanup_workflow: {
        Args: { p_user_id: string; p_dream_id: string; p_claim_token: string };
        Returns: { workflow_id: string | null; claimed: boolean }[];
      };
      record_audio_cleanup_workflow: VoidFunction<{
        p_dream_id: string; p_claim_token: string; p_run_id: string;
      }>;
      release_audio_cleanup_execution: VoidFunction<{
        p_dream_id: string; p_claim_token: string; p_run_id: string;
      }>;
      complete_audio_cleanup_workflow: VoidFunction<{
        p_dream_id: string; p_run_id: string;
      }>;
      expire_stale_audio_processing: {
        Args: { p_dream_id: string; p_user_id: string };
        Returns: string | null;
      };
      prepare_expired_audio_draft_cleanup: {
        Args: { p_dream_id: string; p_user_id: string };
        Returns: string | null;
      };
      complete_expired_audio_draft_cleanup: VoidFunction<{
        p_dream_id: string; p_user_id: string; p_storage_path: string;
      }>;
      create_scene_branch: {
        Args: {
          p_user_id: string;
          p_dream_id: string;
          p_parent_version_id: string;
          p_instruction: string;
          p_model: string;
          p_seed: number;
          p_operation_key: string;
          p_request_hash: string;
        };
        Returns: { version_id: string; claimed: boolean }[];
      };
      select_scene_version: VoidFunction<{
        p_user_id: string;
        p_scene_id: string;
        p_expected_version_id: string;
        p_next_version_id: string;
      }>;
      finalize_dream: VoidFunction<{ p_dream_id: string }>;
      claim_generation_job: {
        Args: {
          p_user_id: string;
          p_dream_id: string;
          p_scene_version_id: string | null;
          p_stage: string;
          p_operation_key: string;
          p_model: string;
          p_endpoint_id: string;
          p_request_hash: string;
        };
        Returns: {
          job_id: string;
          job_status: JobStatus;
          external_id: string | null;
          claimed: boolean;
        }[];
      };
      record_generation_submission: VoidFunction<{ p_job_id: string; p_external_id: string }>;
      claim_branch_workflow: {
        Args: { p_user_id: string; p_version_id: string; p_claim_token: string };
        Returns: { workflow_id: string | null; claimed: boolean }[];
      };
      record_branch_workflow: VoidFunction<{
        p_version_id: string; p_claim_token: string; p_run_id: string;
      }>;
      release_branch_workflow_claim: VoidFunction<{ p_version_id: string; p_claim_token: string }>;
      release_branch_workflow_run: VoidFunction<{ p_version_id: string; p_run_id: string }>;
      release_branch_workflow_execution: VoidFunction<{
        p_version_id: string; p_claim_token: string; p_run_id: string;
      }>;
      update_generation_job: VoidFunction<{
        p_job_id: string;
        p_expected: JobStatus;
        p_next: JobStatus;
        p_delay_ms?: number | null;
        p_execution_ms?: number | null;
        p_error_code?: string | null;
      }>;
      complete_generation_job: VoidFunction<{
        p_job_id: string;
        p_storage_path: string;
        p_cost_usd: string | null;
        p_cost_source: string;
        p_delay_ms?: number | null;
        p_execution_ms?: number | null;
      }>;
    };
    Enums: { dream_status: DreamStatus; job_status: JobStatus };
    CompositeTypes: Record<never, never>;
  };
}
