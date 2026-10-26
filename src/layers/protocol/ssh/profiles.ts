import type { ParsedDiagnosticMetrics } from '../../../shared/types/domain';

export type SshVendorProfile =
  | 'MIKROTIK_ROUTEROS'
  | 'CISCO_IOS_EDGEOS'
  | 'LINUX_BUSYBOX_ONT';

export const SSH_DEFAULT_PORT = 22;
export const SSH_DEFAULT_TIMEOUT_MS = 5000;

/**
 * Lotes predeterminados de comandos seguros en modo no interactivo según fabricante (PRD §7.2).
 */
export const SSH_VENDOR_COMMAND_BATCHES: Readonly<Record<SshVendorProfile, readonly string[]>> = {
  MIKROTIK_ROUTEROS: ['/system resource print', '/interface print'],
  CISCO_IOS_EDGEOS: ['show version', 'show ip interface brief'],
  LINUX_BUSYBOX_ONT: ['cat /proc/uptime', 'ifconfig'],
};

/**
 * Infiere el perfil de comandos SSH más adecuado a partir del fabricante o descripción del equipo.
 */
export const resolveVendorProfile = (vendorOrDescription?: string | null): SshVendorProfile => {
  if (!vendorOrDescription) {
    return 'LINUX_BUSYBOX_ONT';
  }

  const normalized = vendorOrDescription.toLowerCase();
  if (normalized.includes('mikrotik') || normalized.includes('routeros') || normalized.includes('routerboard')) {
    return 'MIKROTIK_ROUTEROS';
  }

  if (
    normalized.includes('cisco') ||
    normalized.includes('ios') ||
    normalized.includes('ubiquiti') ||
    normalized.includes('edgeos') ||
    normalized.includes('edgerouter')
  ) {
    return 'CISCO_IOS_EDGEOS';
  }

  return 'LINUX_BUSYBOX_ONT';
};

/**
 * Parsea la salida de texto crudo de la consola SSH para poblar `ParsedDiagnosticMetrics`.
 */
export const parseSshDiagnosticOutput = (
  rawOutput: string,
  commandsExecuted: readonly string[],
): ParsedDiagnosticMetrics => {
  const metrics: ParsedDiagnosticMetrics = {
    sshCommandsExecuted: [...commandsExecuted],
  };

  // 1. Detección de uptime estilo MikroTik ("uptime: 3d14h22m10s") o Cisco ("uptime is ...")
  const mikrotikUptimeMatch = /uptime:\s*([^\r\n]+)/i.exec(rawOutput);
  const ciscoUptimeMatch = /uptime is\s+([^\r\n]+)/i.exec(rawOutput);
  // 2. Detección de /proc/uptime en Linux/BusyBox ONTs ("124560.45 119000.12")
  const procUptimeMatch = /^(\d+(?:\.\d+)?)\s+\d+(?:\.\d+)?/m.exec(rawOutput);

  if (mikrotikUptimeMatch?.[1]) {
    metrics.sysUpTimeFormatted = mikrotikUptimeMatch[1].trim();
  } else if (ciscoUptimeMatch?.[1]) {
    metrics.sysUpTimeFormatted = ciscoUptimeMatch[1].trim();
  } else if (procUptimeMatch?.[1]) {
    const seconds = Math.floor(Number(procUptimeMatch[1]));
    if (Number.isFinite(seconds) && seconds >= 0) {
      metrics.sysUpTimeTicks = seconds * 100;
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor((seconds % 86400) / 3600);
      const minutes = Math.floor((seconds % 3600) / 60);
      const secs = seconds % 60;
      metrics.sysUpTimeFormatted = `${days}d ${hours}h ${minutes}m ${secs}s`;
    }
  }

  // Detección de board-name / version / plataforma
  const boardMatch = /board-name:\s*([^\r\n]+)/i.exec(rawOutput);
  const versionMatch = /version:\s*([^\r\n]+)/i.exec(rawOutput);
  if (boardMatch?.[1]) {
    metrics.sysDescr = versionMatch?.[1]
      ? `${boardMatch[1].trim()} (${versionMatch[1].trim()})`
      : boardMatch[1].trim();
  }

  const trimmedLines = rawOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  metrics.rawSummary = trimmedLines.slice(0, 12).join('\n');

  return metrics;
};
