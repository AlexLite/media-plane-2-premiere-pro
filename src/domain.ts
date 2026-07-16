export type ReviewScope = "review:read" | "review:comment" | "review:upload" | "review:manage";

export interface PlaneUser { id: string; email: string; displayName: string }
export interface WorkspaceSummary { id: string; slug: string; name: string }
export interface WorkItem { id: string; identifier: string; name: string }
export interface ProjectSummary { id: string; name: string; identifier?: string }

export interface SequenceBinding {
  projectGuid: string;
  sequenceId: string;
  baseUrl: string;
  workspaceSlug: string;
  projectId: string;
  workItemId: string;
}

export interface SequenceInfo {
  projectGuid: string;
  id: string;
  name: string;
  durationSeconds?: number;
}
export type PremiereContext =
  | { status: "no-project" }
  | { status: "no-sequence"; projectGuid: string }
  | { status: "ready"; sequence: SequenceInfo };

export interface ReviewSession {
  asset_id: string;
  integration_token: string;
  expires_in: number;
  can_manage: boolean;
  freeframe_api_url: string;
}

export interface UnlinkedReview { linked: false; can_manage: boolean }
export interface LinkedReview { linked: true; session: ReviewSession }
export type ReviewSessionState = UnlinkedReview | LinkedReview;

export interface ReviewAsset { id: string; name: string; asset_type: string; description?: string | null }
export interface ReviewPermissions { read: boolean; comment: boolean; upload: boolean; manage: boolean }
export interface ReviewVersion { id: string; version_number: number; processing_status: string; created_at: string | null }
export interface ReviewBootstrap { asset: ReviewAsset; versions: ReviewVersion[]; permissions: ReviewPermissions }

export interface ReviewComment {
  id: string;
  asset_id: string;
  version_id: string;
  body: string;
  resolved: boolean;
  author?: { id: string; name: string; avatar_url: string | null } | null;
  annotation?: { frame_number: number | null } | null;
  range_end_frame?: number | null;
  fps_numerator?: number | null;
  fps_denominator?: number | null;
}

export interface Marker { id: string; startSeconds: number; name: string; comments: string }
export interface MarkerWrite { startSeconds: number; name: string; comments: string }
