import os from "node:os";

export interface LanAddress {
  address: string;
  iface: string;
  score: number;
}

function scoreAddress(address: string, iface: string): number {
  let score = 0;
  if (address.startsWith("192.168.")) score += 40;
  else if (address.startsWith("10.")) score += 30;
  else if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) score += 25;
  else score += 10;
  // Preferir adaptadores fisicos frente a VPN / virtuales.
  if (/wi-?fi|wlan|ethernet|eth\d|en\d/i.test(iface)) score += 10;
  if (/vethernet|virtual|vmware|virtualbox|hyper-v|loopback|tap|tun|vpn/i.test(iface)) score -= 50;
  return score;
}

export function lanAddresses(): LanAddress[] {
  const out: LanAddress[] = [];
  const interfaces = os.networkInterfaces();
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      out.push({ address: entry.address, iface: name, score: scoreAddress(entry.address, name) });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

export function primaryLanAddress(): string | null {
  return lanAddresses()[0]?.address ?? null;
}

export function mobileUrl(port: number, token: string, address?: string | null): string {
  const host = address ?? primaryLanAddress() ?? "127.0.0.1";
  return `http://${host}:${port}/m?t=${encodeURIComponent(token)}`;
}
