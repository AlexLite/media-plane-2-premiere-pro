import type { PlaneComment, PlaneState, WorkItem } from "./domain";
import { timecodesFromHtml, validTimecodes } from "./timecode";

export class PlaneError extends Error { constructor(message: string, readonly status?: number) { super(message); } }
export class PlaneClient {
  readonly root: string;
  constructor(baseUrl: string, private readonly token: string) { this.root = baseUrl.replace(/\/$/, ""); }
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.root}/api/v1${path}`, { ...init, headers: { "X-API-Key": this.token, "Content-Type": "application/json", ...init.headers } });
    if (!response.ok) throw new PlaneError(`Plane request failed (${response.status})`, response.status);
    return response.status === 204 ? undefined as T : await response.json() as T;
  }
  async validate() { await this.request<unknown>("/workspaces/"); }
  async getProjects(workspace: string): Promise<Array<{ id: string; name: string; identifier?: string }>> { const data = await this.request<any>(`/workspaces/${encodeURIComponent(workspace)}/projects/`); return Array.isArray(data) ? data : data.results ?? []; }
  async getIssues(workspace: string, project: string): Promise<WorkItem[]> { const data = await this.request<any>(`/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}/issues/`); return Array.isArray(data) ? data : data.results ?? []; }
  async getWorkItem(workspace: string, project: string, issue: string) { return this.request<WorkItem>(`/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}/issues/${encodeURIComponent(issue)}/`); }
  async getStates(workspace: string, project: string) { return this.request<PlaneState[]>(`/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}/states/`); }
  async updateState(workspace: string, project: string, issue: string, state: string) { return this.request<WorkItem>(`/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}/issues/${encodeURIComponent(issue)}/`, { method: "PATCH", body: JSON.stringify({ state }) }); }
  async getComments(workspace: string, project: string, issue: string): Promise<PlaneComment[]> {
    const data = await this.request<PlaneComment[] | { results: PlaneComment[] }>(`/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}/issues/${encodeURIComponent(issue)}/comments/`);
    const comments = Array.isArray(data) ? data : data.results;
    return comments.map(c => ({ ...c, timecodes: c.timecodes ? validTimecodes(c.timecodes) : timecodesFromHtml(c.comment_html) }));
  }
  async createComment(workspace: string, project: string, issue: string, commentHtml: string) {
    return this.request<PlaneComment>(`/workspaces/${encodeURIComponent(workspace)}/projects/${encodeURIComponent(project)}/issues/${encodeURIComponent(issue)}/comments/`, { method: "POST", body: JSON.stringify({ comment_html: commentHtml }) });
  }
}
