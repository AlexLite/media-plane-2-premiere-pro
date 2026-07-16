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

export interface ReviewAsset {
  id: string;
  name: string;
  asset_type: string;
  description?: string | null;
  status?: string;
  thumbnail_url?: string | null;
}
export interface ReviewPermissions { read: boolean; comment: boolean; upload: boolean; manage: boolean }
export interface ReviewVersion {
  id: string;
  version_number: number;
  processing_status: string;
  created_at: string | null;
  original_filename?: string | null;
  mime_type?: string | null;
  file_size_bytes?: number | null;
  duration_seconds?: number | null;
  fps_numerator?: number | null;
  fps_denominator?: number | null;
}
export interface ReviewBootstrapContext { workspace_id: string; project_id: string; issue_id: string }
export interface ReviewBootstrap {
  context: ReviewBootstrapContext;
  asset: ReviewAsset;
  versions: ReviewVersion[];
  permissions: ReviewPermissions;
}
export interface ReviewStream { url: string; asset_type: string; expires_in: number }

export interface ReviewCommentAuthor { id: string; name: string; avatar_url: string | null }
export interface ReviewCommentGuestAuthor { id: string; name: string; email: string }
export interface ReviewCommentAnnotation {
  id: string;
  comment_id: string;
  drawing_data: Record<string, unknown>;
  frame_number: number | null;
  carousel_position: number | null;
}
export interface ReviewComment {
  id: string;
  asset_id: string;
  version_id: string;
  parent_id: string | null;
  author_id: string | null;
  guest_author_id: string | null;
  timecode_start: number | null;
  timecode_end: number | null;
  body: string;
  resolved: boolean;
  visibility: "public";
  created_at: string;
  updated_at: string;
  author: ReviewCommentAuthor | null;
  guest_author: ReviewCommentGuestAuthor | null;
  annotation: ReviewCommentAnnotation | null;
  replies: ReviewComment[];
}

export interface Marker {
  id: string;
  startSeconds: number;
  durationSeconds?: number;
  name: string;
  comments: string;
  markerType?: string;
}
export interface MarkerWrite {
  startSeconds: number;
  durationSeconds?: number;
  name: string;
  comments: string;
  markerType?: string;
}
