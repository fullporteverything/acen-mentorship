export interface CaptureLogData {
  discordId?: string;
  discordUsername?: string;
  timestamp: string;
  ip?: string;
  userAgent?: string;
}

export interface SecurityMemberData {
  discordId: string;
  discordUsername: string;
  strikes: number;
  locked: boolean;
  updatedAt: string;
}

export async function loadAdminSecurity(): Promise<{
  logs: CaptureLogData[];
  members: SecurityMemberData[];
}> {
  const response = await fetch("/api/admin/capture-logs");
  if (!response.ok) throw new Error("Couldn't load security records.");
  const data = await response.json().catch(() => null);
  return {
    logs: Array.isArray(data?.logs) ? data.logs : [],
    members: Array.isArray(data?.members) ? data.members : [],
  };
}
