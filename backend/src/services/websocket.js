// ═══════════════════════════════════════════════════════════
// DEEMONA FINANCE SOLUTION — WebSocket Server
// Pushes real-time KPI updates, alerts, and chart data
// to connected frontend clients.
// ═══════════════════════════════════════════════════════════

const WebSocket = require('ws');
const config = require('../../config');
const dataService = require('./database');
const { DASHBOARDS } = require('../data/dashboards');

let wss = null;
const clients = new Map(); // clientId -> { ws, subscriptions, role }

function startWebSocket(server) {
  if (!config.websocket.enabled) {
    console.log('[WS] WebSocket disabled in config');
    return;
  }

  // Attach to existing HTTP server
  wss = new WebSocket.Server({ server, path: '/v1/stream' });

  console.log(`[WS] WebSocket server attached at ws://localhost:${config.server.port}/v1/stream`);

  wss.on('connection', (ws, req) => {
    const clientId = require('crypto').randomUUID();
    clients.set(clientId, { ws, subscriptions: new Set(), role: null });
    console.log(`[WS] Client connected: ${clientId} (total: ${clients.size})`);

    // Send welcome message
    send(ws, {
      event: 'connected',
      payload: {
        client_id: clientId,
        server: 'Deemona Finance Solution',
        version: '1.0.0',
        available_events: ['kpi_update', 'chart_update', 'alert', 'heartbeat'],
        commands: ['subscribe', 'unsubscribe', 'set_role', 'refresh'],
      },
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        handleClientMessage(clientId, msg);
      } catch (e) {
        send(ws, { event: 'error', payload: { message: 'Invalid JSON' } });
      }
    });

    ws.on('close', () => {
      clients.delete(clientId);
      console.log(`[WS] Client disconnected: ${clientId} (total: ${clients.size})`);
    });

    ws.on('error', (err) => {
      console.error(`[WS] Client error ${clientId}:`, err.message);
      clients.delete(clientId);
    });
  });

  // Heartbeat to keep connections alive
  setInterval(() => {
    broadcast({ event: 'heartbeat', payload: { timestamp: new Date().toISOString(), clients: clients.size } });
  }, config.websocket.heartbeatInterval);

  // Start staggered data push
  startDataPush();
}

function handleClientMessage(clientId, msg) {
  const client = clients.get(clientId);
  if (!client) return;

  switch (msg.command) {
    case 'subscribe':
      // Subscribe to specific dashboard updates
      // { command: 'subscribe', dashboard_ids: [1, 3, 17] }
      if (Array.isArray(msg.dashboard_ids)) {
        msg.dashboard_ids.forEach(id => client.subscriptions.add(id));
        send(client.ws, { event: 'subscribed', payload: { dashboard_ids: [...client.subscriptions] } });
      }
      break;

    case 'unsubscribe':
      if (Array.isArray(msg.dashboard_ids)) {
        msg.dashboard_ids.forEach(id => client.subscriptions.delete(id));
        send(client.ws, { event: 'unsubscribed', payload: { dashboard_ids: [...client.subscriptions] } });
      }
      break;

    case 'set_role':
      // Filter updates by role
      // { command: 'set_role', role: 'CFO' }
      client.role = msg.role;
      const accessible = DASHBOARDS.filter(d => d.roles.includes(msg.role)).map(d => d.id);
      send(client.ws, { event: 'role_set', payload: { role: msg.role, accessible_dashboards: accessible } });
      break;

    case 'refresh':
      // Manual refresh for a specific dashboard
      // { command: 'refresh', dashboard_id: 1 }
      if (msg.dashboard_id) {
        const kpis = dataService.generateKpis(msg.dashboard_id);
        const charts = dataService.generateCharts(msg.dashboard_id);
        if (kpis) send(client.ws, { event: 'kpi_update', dashboard_id: msg.dashboard_id, payload: kpis });
        if (charts) send(client.ws, { event: 'chart_update', dashboard_id: msg.dashboard_id, payload: charts });
      }
      break;

    default:
      send(client.ws, { event: 'error', payload: { message: `Unknown command: ${msg.command}` } });
  }
}

// Push data at staggered intervals per refresh cycle
function startDataPush() {
  const cycleGroups = {};
  DASHBOARDS.forEach(d => {
    const cycle = d.cycle || 'On Demand';
    if (!cycleGroups[cycle]) cycleGroups[cycle] = [];
    cycleGroups[cycle].push(d);
  });

  Object.entries(cycleGroups).forEach(([cycle, dashboards]) => {
    const interval = config.refresh[cycle];
    if (!interval) return; // On Demand = no auto push

    console.log(`[WS] Scheduling ${cycle} push: ${dashboards.length} dashboards every ${interval / 1000}s`);

    setInterval(() => {
      dashboards.forEach((d, i) => {
        // Stagger within interval to avoid burst
        setTimeout(() => {
          const kpis = dataService.generateKpis(d.id);
          pushToDashboardSubscribers(d.id, 'kpi_update', kpis);

          // Occasionally send alerts
          if (Math.random() > 0.85) {
            const alert = dataService.generateNotification();
            alert.dashboard_id = d.id;
            pushToDashboardSubscribers(d.id, 'alert', alert);
            // Also broadcast alerts to everyone
            broadcast({ event: 'alert', payload: alert });
          }
        }, i * 200);
      });
    }, interval);
  });
}

// Send to specific dashboard subscribers
function pushToDashboardSubscribers(dashboardId, event, payload) {
  const dash = DASHBOARDS.find(d => d.id === dashboardId);

  clients.forEach((client) => {
    // Send if: subscribed to this dashboard OR has matching role OR no filters set
    const subscribed = client.subscriptions.has(dashboardId) || client.subscriptions.size === 0;
    const roleMatch = !client.role || (dash && dash.roles.includes(client.role));

    if (subscribed && roleMatch) {
      send(client.ws, { event, dashboard_id: dashboardId, payload });
    }
  });
}

// Broadcast to all connected clients
function broadcast(data) {
  clients.forEach((client) => send(client.ws, data));
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function getStats() {
  return {
    connected_clients: clients.size,
    enabled: config.websocket.enabled,
  };
}

module.exports = { startWebSocket, broadcast, getStats };
