import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { api, ApiError } from "./api";
import type { ProjectSummary, User } from "./types";

export interface Me {
  user: User;
  projects: ProjectSummary[];
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.get<Me>("/auth/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function useRefreshMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["me"] });
}

/** Current project from the URL, with the user's role in it. */
export function useProject() {
  const { projectId = "" } = useParams();
  const me = useMe();
  const project = me.data?.projects.find((p) => p.id === projectId);
  const role = project?.role ?? "VIEWER";
  return {
    projectId,
    project,
    role,
    canEdit: role === "OWNER" || role === "EDITOR",
    isOwner: role === "OWNER",
    user: me.data?.user,
  };
}
