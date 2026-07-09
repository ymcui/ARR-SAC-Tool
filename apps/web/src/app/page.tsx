import { DashboardShell } from "@/components/dashboard-shell";

export const dynamic = "force-dynamic";

function apiOriginFromRuntime(): string | undefined {
  const configuredOrigin = process.env.ARR_SAC_API_ORIGIN ?? process.env.NEXT_PUBLIC_ARR_SAC_API_ORIGIN;
  if (configuredOrigin) {
    return configuredOrigin;
  }

  const apiHost = process.env.ARR_SAC_API_HOST ?? "127.0.0.1";
  const apiPort = process.env.ARR_SAC_API_PORT ?? "8001";
  return `http://${apiHost}:${apiPort}`;
}

export default function Page() {
  return <DashboardShell configuredApiOrigin={apiOriginFromRuntime()} />;
}
