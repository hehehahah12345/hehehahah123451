// Real computer information, read with the "systeminformation" library.
const si = require('systeminformation');

const round = (n, d = 1) => (typeof n === 'number' && isFinite(n) ? Number(n.toFixed(d)) : null);
const gb = (bytes) => round(bytes / 1024 ** 3, 1);

// Full spec sheet: used by the "This computer" card and the computer_info tool.
async function specs() {
  const [cpu, mem, gfx, disks, temp, battery, os, nets, defIface] = await Promise.all([
    si.cpu(), si.mem(), si.graphics(), si.fsSize(), si.cpuTemperature(),
    si.battery(), si.osInfo(), si.networkInterfaces(), si.networkInterfaceDefault(),
  ].map((p) => p.catch(() => null)));

  const iface = Array.isArray(nets) ? (nets.find((n) => n.iface === defIface) || nets.find((n) => !n.internal && n.ip4)) : null;
  let wifi = null;
  try { const w = await si.wifiConnections(); if (w && w[0]) wifi = { ssid: w[0].ssid, signal: w[0].quality ?? w[0].signalLevel }; } catch {}

  return {
    os: os ? `${os.distro} ${os.release} (${os.arch})` : null,
    hostname: os?.hostname || null,
    cpu: cpu ? {
      name: `${cpu.manufacturer} ${cpu.brand}`.trim(),
      cores: cpu.physicalCores, threads: cpu.cores,
      baseGHz: cpu.speed, maxGHz: cpu.speedMax || null,
    } : null,
    memory: mem ? { totalGB: gb(mem.total), usedGB: gb(mem.active), freeGB: gb(mem.available) } : null,
    graphics: gfx?.controllers?.map((g) => ({ name: `${g.vendor || ''} ${g.model || ''}`.trim(), vramMB: g.vram || null })) || [],
    displays: gfx?.displays?.map((d) => `${d.resolutionX}x${d.resolutionY}${d.currentRefreshRate ? ' @' + d.currentRefreshRate + 'Hz' : ''}`) || [],
    disks: (disks || []).filter((d) => d.size > 1e9).map((d) => ({
      mount: d.mount, sizeGB: gb(d.size), usedGB: gb(d.used), usePercent: round(d.use, 0),
    })),
    temperatures: temp && temp.main != null ? { cpuC: round(temp.main, 0), maxC: round(temp.max, 0), cores: temp.cores } : 'not available on this computer',
    battery: battery && battery.hasBattery ? {
      percent: battery.percent, charging: battery.isCharging, pluggedIn: battery.acConnected,
      minutesLeft: battery.timeRemaining > 0 ? battery.timeRemaining : null,
    } : 'no battery (desktop)',
    network: iface ? { adapter: iface.ifaceName || iface.iface, type: iface.type, ip: iface.ip4, mac: iface.mac, speedMbps: iface.speed, wifi } : null,
  };
}

// Small, fast reading for the live "Systems" card (every 2 seconds).
let lastNet = null;
async function live() {
  const [load, mem, temp, battery, net] = await Promise.all([
    si.currentLoad(), si.mem(), si.cpuTemperature(), si.battery(), si.networkStats(),
  ].map((p) => p.catch(() => null)));
  const n = Array.isArray(net) ? net[0] : null;
  let down = null, up = null;
  if (n && n.rx_sec != null && n.rx_sec >= 0) { down = n.rx_sec; up = n.tx_sec; }
  else if (n && lastNet) { down = (n.rx_bytes - lastNet.rx_bytes) / 2; up = (n.tx_bytes - lastNet.tx_bytes) / 2; }
  if (n) lastNet = n;
  return {
    cpu: round(load?.currentLoad, 0),
    mem: mem ? round((mem.active / mem.total) * 100, 0) : null,
    memUsedGB: mem ? gb(mem.active) : null,
    memTotalGB: mem ? gb(mem.total) : null,
    tempC: temp?.main != null ? round(temp.main, 0) : null,
    battery: battery?.hasBattery ? { percent: battery.percent, charging: battery.isCharging } : null,
    netDownKBs: down != null ? round(down / 1024, 0) : null,
    netUpKBs: up != null ? round(up / 1024, 0) : null,
  };
}

module.exports = { specs, live };
