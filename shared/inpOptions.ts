export interface InpOverrides {
  reportStepMinutes?: number;
  flowRouting?: string;
  startDate?: string;
  endDate?: string;
  routingStepSeconds?: number;
}

const ROUTING_MAP: Record<string, string> = {
  steady: 'STEADY',
  kinematic: 'KINWAVE',
  dynamic: 'DYNWAVE',
};

function minutesToHms(minutes: number): string {
  const total = Math.max(0, Math.round(minutes * 60));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function secondsToHms(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function isoToSwmmDate(iso: string): string | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

function setOption(optionsSection: string, key: string, value: string): string {
  const lineRe = new RegExp(`^(${key})[ \\t]+\\S.*$`, 'im');
  if (lineRe.test(optionsSection)) {
    return optionsSection.replace(lineRe, `${key.padEnd(20)} ${value}`);
  }
  return optionsSection.replace(/^\[OPTIONS\][^\n]*/im, (header) => `${header}\n${key.padEnd(20)} ${value}`);
}

export function applyInpOverrides(content: string, overrides: InpOverrides): string {
  const entries: [string, string][] = [];

  if (overrides.reportStepMinutes !== undefined && overrides.reportStepMinutes > 0) {
    entries.push(['REPORT_STEP', minutesToHms(overrides.reportStepMinutes)]);
  }
  if (overrides.flowRouting && ROUTING_MAP[overrides.flowRouting.toLowerCase()]) {
    entries.push(['FLOW_ROUTING', ROUTING_MAP[overrides.flowRouting.toLowerCase()]]);
  }
  if (overrides.startDate) {
    const d = isoToSwmmDate(overrides.startDate) ?? (/^\d{2}\/\d{2}\/\d{4}$/.test(overrides.startDate) ? overrides.startDate : null);
    if (d) {
      entries.push(['START_DATE', d]);
      entries.push(['REPORT_START_DATE', d]);
    }
  }
  if (overrides.endDate) {
    const d = isoToSwmmDate(overrides.endDate) ?? (/^\d{2}\/\d{2}\/\d{4}$/.test(overrides.endDate) ? overrides.endDate : null);
    if (d) entries.push(['END_DATE', d]);
  }
  if (overrides.routingStepSeconds !== undefined && overrides.routingStepSeconds > 0) {
    entries.push(['ROUTING_STEP', secondsToHms(overrides.routingStepSeconds)]);
  }

  if (entries.length === 0) return content;

  const sectionRe = /(\[OPTIONS\])([\s\S]*?)(?=\n\s*\[|$)/i;
  const match = content.match(sectionRe);

  if (match) {
    const start = content.indexOf(match[0]);
    const end = start + match[0].length;
    let section = match[0];
    for (const [key, value] of entries) {
      section = setOption(section, key, value);
    }
    return content.substring(0, start) + section + content.substring(end);
  }

  const block = entries.map(([k, v]) => `${k.padEnd(20)} ${v}`).join('\n');
  return `[OPTIONS]\n${block}\n\n${content}`;
}
