export enum ProviderStatus {
  Healthy = "healthy",
  Degraded = "degraded",
  Stale = "stale",
  Unavailable = "unavailable",
  Disabled = "disabled",
}

export enum HealthStatus {
  Healthy = "healthy",
  Degraded = "degraded",
  Critical = "critical",
}

export enum ProviderStatusReason {
  DisabledInRuntime = "disabled_in_runtime",
}

export function providerStatusPresentation(provider: {
  active: boolean;
  status: string;
  statusReason: string;
}) {
  if (!provider.active) {
    return {
      label:
        provider.statusReason === ProviderStatusReason.DisabledInRuntime
          ? "Disabled in this runtime"
          : "Disabled",
      color: "text-status-disabled",
    };
  }
  switch (provider.status) {
    case ProviderStatus.Healthy:
      return { label: "Healthy", color: "text-status-healthy" };
    case ProviderStatus.Degraded:
      return { label: "Degraded", color: "text-error" };
    case ProviderStatus.Stale:
      return { label: "Stale", color: "text-error" };
    case ProviderStatus.Unavailable:
      return { label: "Unavailable", color: "text-on-surface-variant" };
    default:
      return {
        label:
          provider.status.charAt(0).toUpperCase() + provider.status.slice(1),
        color: "text-on-surface-variant",
      };
  }
}

export function healthStatusColor(status: HealthStatus) {
  switch (status) {
    case HealthStatus.Healthy:
      return "text-status-healthy";
    case HealthStatus.Critical:
      return "text-red-800 dark:text-red-300 bg-red-500/10 px-1.5 py-0.5 rounded";
    default:
      return "text-error";
  }
}
