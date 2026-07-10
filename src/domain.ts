export interface PlaneTimecode { value: string; seconds: number }
export interface PlaneComment { id: string; comment_html: string; created_at?: string; actor_detail?: { display_name?: string; first_name?: string }; timecodes?: PlaneTimecode[] }
export interface WorkItem { id: string; identifier: string; name: string; state?: string; state_detail?: { id: string; name: string }; project?: string }
export interface PlaneState { id: string; name: string }
export interface SequenceBinding { sequenceId: string; baseUrl: string; workspaceSlug: string; projectId: string; workItemId: string }
export interface SequenceInfo { id: string; name: string; durationSeconds: number; fps: number }
export interface Marker { id: string; startSeconds: number; name: string; comments: string }
export interface MarkerWrite { startSeconds: number; name: string; comments: string }
