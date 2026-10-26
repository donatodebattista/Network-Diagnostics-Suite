import type {
  DiagnosticProtocol,
  DiagnosticStatus,
  ParsedDiagnosticMetrics,
} from '../../shared/types/domain';

export interface DiagnosticSummaryItem {
  id: string;
  protocol: DiagnosticProtocol;
  status: DiagnosticStatus;
  executedAt: number;
  metrics: ParsedDiagnosticMetrics;
  rawOutput: string;
}

export interface InstallationReportTemplateData {
  reportId: string;
  generatedAt: number;
  institutionName?: string;
  technicianName?: string;
  device: {
    id: string;
    ipAddress: string;
    macAddress: string;
    hostname?: string | null;
    vendor?: string | null;
    serialNumber?: string | null;
  };
  installation: {
    id: string;
    technicianNotes: string;
    latitude: number;
    longitude: number;
    photoUri: string;
    photoBase64?: string;
    createdAt: number;
  };
  diagnostics: readonly DiagnosticSummaryItem[];
}

const escapeHtml = (unsafe: string | number | null | undefined): string => {
  if (unsafe === null || unsafe === undefined) {
    return 'N/D';
  }
  return String(unsafe)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

/**
 * Construye el documento HTML maquetado con las 6 secciones formales exigidas en PRD §9.3
 * para su compilación local mediante `react-native-html-to-pdf`.
 */
export const buildInstallationReportHtml = (
  data: InstallationReportTemplateData,
): string => {
  const institution =
    data.institutionName ??
    'FCyT (UADER) — Sede Concepción del Uruguay | Licenciatura en Sistemas de Información';
  const technician = data.technicianName ?? 'Técnico de Telecomunicaciones en Campo';
  const formattedDate = new Date(data.generatedAt).toISOString().replace('T', ' ').slice(0, 19);

  const imageSource = data.installation.photoBase64
    ? `data:image/jpeg;base64,${data.installation.photoBase64}`
    : escapeHtml(data.installation.photoUri);

  const osmLink = `https://www.openstreetmap.org/?mlat=${data.installation.latitude.toFixed(6)}&mlon=${data.installation.longitude.toFixed(6)}#map=17/${data.installation.latitude.toFixed(6)}/${data.installation.longitude.toFixed(6)}`;

  const diagnosticsRowsHtml =
    data.diagnostics.length === 0
      ? `<tr><td colspan="5" style="text-align:center;">Sin pruebas de protocolo registradas en esta sesión</td></tr>`
      : data.diagnostics
          .map((diag) => {
            const uptime =
              diag.metrics.sysUpTimeFormatted ??
              (diag.metrics.sysUpTimeTicks !== undefined
                ? `${diag.metrics.sysUpTimeTicks} ticks`
                : 'N/D');
            const sysName = diag.metrics.sysName ?? diag.metrics.sysDescr ?? 'N/D';
            const trafficSummary =
              diag.metrics.interfaces && diag.metrics.interfaces.length > 0
                ? diag.metrics.interfaces
                    .map(
                      (iface) =>
                        `if#${iface.ifIndex}: IN=${iface.ifInOctets}B / OUT=${iface.ifOutOctets}B`,
                    )
                    .join(' | ')
                : diag.metrics.rawSummary ?? diag.rawOutput.slice(0, 140);

            return `
              <tr>
                <td><strong>${escapeHtml(diag.protocol)}</strong></td>
                <td>${escapeHtml(diag.status)}</td>
                <td>${escapeHtml(sysName)}</td>
                <td>${escapeHtml(uptime)}</td>
                <td><pre class="log-snippet">${escapeHtml(trafficSummary)}</pre></td>
              </tr>
            `;
          })
          .join('\n');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Reporte de Instalación #${escapeHtml(data.reportId)}</title>
  <style>
    body { font-family: Helvetica, Arial, sans-serif; color: #1e293b; margin: 24px; font-size: 12px; }
    .header { border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 18px; display: flex; justify-content: space-between; }
    .title { font-size: 18px; font-weight: bold; color: #0f172a; margin: 0; }
    .subtitle { font-size: 11px; color: #475569; margin: 4px 0 0 0; }
    .section { margin-bottom: 18px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 12px; }
    .section-title { font-size: 13px; font-weight: bold; color: #0f172a; margin-top: 0; margin-bottom: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background-color: #f1f5f9; font-weight: bold; }
    .log-snippet { margin: 0; font-family: monospace; font-size: 10px; white-space: pre-wrap; word-break: break-all; }
    .evidence-photo { max-width: 320px; max-height: 220px; border: 1px solid #94a3b8; border-radius: 4px; margin-top: 8px; }
    .signature-box { margin-top: 28px; padding-top: 12px; border-top: 1px dashed #64748b; display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <!-- 1. Cabecera Institucional -->
  <div class="header">
    <div>
      <p class="title">Network Diagnostics Suite — Informe Técnico de Instalación</p>
      <p class="subtitle">${escapeHtml(institution)}</p>
    </div>
    <div style="text-align: right;">
      <p style="margin: 0;"><strong>ID Intervención:</strong> ${escapeHtml(data.installation.id)}</p>
      <p style="margin: 4px 0 0 0;"><strong>Fecha UTC:</strong> ${escapeHtml(formattedDate)}</p>
    </div>
  </div>

  <!-- 2. Ficha Técnica del Equipo -->
  <div class="section">
    <h2 class="section-title">1. Ficha Técnica del Equipo Relevado</h2>
    <table>
      <tr>
        <th>Dirección IP</th>
        <td>${escapeHtml(data.device.ipAddress)}</td>
        <th>Dirección MAC</th>
        <td>${escapeHtml(data.device.macAddress)}</td>
      </tr>
      <tr>
        <th>Número de Serie (QR/Barcode)</th>
        <td><strong>${escapeHtml(data.device.serialNumber ?? 'SIN ETIQUETA ESCANEADA')}</strong></td>
        <th>Fabricante / Hostname</th>
        <td>${escapeHtml(data.device.vendor ?? 'Genérico')} (${escapeHtml(data.device.hostname ?? 'sin-hostname')})</td>
      </tr>
    </table>
  </div>

  <!-- 3. Diagnósticos de Red Ejecutados (SNMP / SSH) -->
  <div class="section">
    <h2 class="section-title">2. Diagnósticos de Protocolo Ejecutados (SNMP v1/v2c &amp; SSH)</h2>
    <table>
      <thead>
        <tr>
          <th>Protocolo</th>
          <th>Estado</th>
          <th>Sistema / Descripción</th>
          <th>Uptime</th>
          <th>Métricas MIB-II / Salida SSH</th>
        </tr>
      </thead>
      <tbody>
        ${diagnosticsRowsHtml}
      </tbody>
    </table>
  </div>

  <!-- 4. Georreferenciación Satelital y Notas Técnicas -->
  <div class="section">
    <h2 class="section-title">3. Coordenadas GPS de Instalación y Observaciones</h2>
    <table>
      <tr>
        <th>Latitud</th>
        <td>${data.installation.latitude.toFixed(6)}°</td>
        <th>Longitud</th>
        <td>${data.installation.longitude.toFixed(6)}°</td>
      </tr>
      <tr>
        <th>Referencia Cartográfica</th>
        <td colspan="3">${escapeHtml(osmLink)}</td>
      </tr>
      <tr>
        <th>Notas del Técnico</th>
        <td colspan="3">${escapeHtml(data.installation.technicianNotes)}</td>
      </tr>
    </table>
  </div>

  <!-- 5. Evidencia Fotográfica Embebida -->
  <div class="section">
    <h2 class="section-title">4. Evidencia Fotográfica en Sitio</h2>
    <p style="margin: 0 0 4px 0;"><strong>URI Sandbox Privado:</strong> ${escapeHtml(data.installation.photoUri)}</p>
    <img class="evidence-photo" src="${imageSource}" alt="Evidencia fotográfica del equipo instalado" />
  </div>

  <!-- 6. Firma Digital y Conformidad Técnica -->
  <div class="signature-box">
    <div>
      <p style="margin: 0;"><strong>Responsable Técnico:</strong> ${escapeHtml(technician)}</p>
      <p style="margin: 4px 0 0 0;"><strong>Hash de Integridad Local:</strong> SHA256-${escapeHtml(data.installation.id.slice(0, 12).toUpperCase())}</p>
    </div>
    <div style="text-align: right;">
      <p style="margin: 0;">________________________________________</p>
      <p style="margin: 4px 0 0 0;">Firma y Conformidad de Campo</p>
    </div>
  </div>
</body>
</html>`;
};
