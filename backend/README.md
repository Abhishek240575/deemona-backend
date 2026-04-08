# 🏦 Deemona Finance Solution — Backend API

Real-Time Financial Intelligence Platform powering 32 finance dashboards with REST API, WebSocket streaming, role-based access, and staggered refresh architecture.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your settings

# 3. Start server
npm start        # production
npm run dev      # development (auto-reload)
```

Server starts at **http://localhost:3000**

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    CLIENTS                            │
│  ┌─────────┐  ┌───────────┐  ┌──────────────────┐   │
│  │ Browser │  │ Mobile App│  │ Third-party APIs  │   │
│  └────┬────┘  └─────┬─────┘  └────────┬─────────┘   │
│       └─────────────┼─────────────────┘              │
└─────────────────────┼────────────────────────────────┘
                      │
         ┌────────────┴────────────┐
         │     LOAD BALANCER       │
         └────────────┬────────────┘
                      │
    ┌─────────────────┼─────────────────┐
    │            API SERVER             │
    │                                   │
    │  ┌───────────┐  ┌──────────────┐  │
    │  │ REST API  │  │  WebSocket   │  │
    │  │ (Express) │  │  (ws)        │  │
    │  └─────┬─────┘  └──────┬───────┘  │
    │        └────────┬───────┘         │
    │           ┌─────┴──────┐          │
    │           │ Data Layer │          │
    │           │ (Services) │          │
    │           └─────┬──────┘          │
    └─────────────────┼─────────────────┘
                      │
         ┌────────────┴────────────┐
         │   Database / Cache      │
         │ (PostgreSQL + Redis)    │
         └─────────────────────────┘
```

## API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/auth/token` | Generate JWT token |

### Dashboards

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/dashboards` | List all dashboards (filterable) |
| GET | `/v1/dashboards/:id` | Single dashboard metadata |
| GET | `/v1/dashboards/:id/kpis` | Real-time KPI data |
| GET | `/v1/dashboards/:id/charts` | Chart data with datasets |
| GET | `/v1/dashboards/:id/full` | Combined KPIs + charts + metadata |
| GET | `/v1/dashboards/:id/alerts` | Active alerts for dashboard |
| POST | `/v1/dashboards/:id/export` | Export data (CSV or JSON) |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/health` | Health check |
| GET | `/v1/stats` | System statistics |
| GET | `/v1/roles` | Roles with dashboard access |
| GET | `/v1/notifications` | Latest notifications |

### Query Parameters

**GET /v1/dashboards** supports filtering:
```
?cycle=Daily          # Filter by refresh cycle
?role=CFO             # Filter by role access
?category=Treasury    # Filter by category
?search=cash          # Search by name/category
```

**GET /v1/notifications** supports:
```
?limit=20             # Max results (default: 20, max: 50)
?type=critical        # Filter by alert type
```

## Authentication

### API Key (recommended for server-to-server)
```bash
curl -H "X-API-Key: your-api-key" http://localhost:3000/v1/dashboards
```

### Bearer Token (recommended for user sessions)
```bash
# Get token
curl -X POST http://localhost:3000/v1/auth/token \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","role":"CFO"}'

# Use token
curl -H "Authorization: Bearer <token>" http://localhost:3000/v1/dashboards/1/kpis
```

## WebSocket

Connect to `ws://localhost:3000/v1/stream` for real-time data streaming.

### Client Commands

```json
// Subscribe to specific dashboards
{"command": "subscribe", "dashboard_ids": [1, 3, 17]}

// Unsubscribe
{"command": "unsubscribe", "dashboard_ids": [17]}

// Set role filter (only receive dashboards you have access to)
{"command": "set_role", "role": "CFO"}

// Manual refresh
{"command": "refresh", "dashboard_id": 1}
```

### Server Events

```json
// KPI update
{"event": "kpi_update", "dashboard_id": 1, "payload": {...}}

// Chart update  
{"event": "chart_update", "dashboard_id": 1, "payload": {...}}

// Alert
{"event": "alert", "payload": {"type": "critical", "message": "...", ...}}

// Heartbeat (every 30s)
{"event": "heartbeat", "payload": {"timestamp": "...", "clients": 5}}
```

## Staggered Refresh

To prevent backend overload, dashboards refresh at different rates:

| Cycle | Interval | Dashboards | Use Case |
|-------|----------|------------|----------|
| Daily | 15 sec | 6 | Cash flow, A/R, A/P, Treasury, Fraud, Trading |
| Weekly | 2 min | 6 | Revenue, Expense, Billing, Payroll, Time, Customer |
| Monthly | 5 min | 8 | Profitability, Budget, Forecasting, GL, Risk, Controls |
| Quarterly | 10 min | 10 | Board, Strategy, Balance Sheet, Compliance, Loans |
| On Demand | Manual | 2 | CFO Dashboard, Cost Allocation |

## Docker

```bash
# Build and run
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

## Project Structure

```
deemona-backend/
├── config/
│   └── index.js           # Environment configuration
├── public/
│   └── index.html          # Frontend dashboard (served by Express)
├── src/
│   ├── server.js           # Main Express server
│   ├── data/
│   │   └── dashboards.js   # All 32 dashboard definitions
│   ├── middleware/
│   │   └── auth.js         # JWT + API key authentication
│   ├── routes/
│   │   └── api.js          # REST API routes
│   └── services/
│       ├── dataService.js   # Data generation / DB queries
│       └── websocket.js     # WebSocket real-time server
├── .env                     # Environment variables
├── .env.example             # Template
├── Dockerfile
├── docker-compose.yml
├── package.json
└── README.md
```

## Production Checklist

- [ ] Change `JWT_SECRET` and `API_KEY` in `.env`
- [ ] Set `AUTH_ENABLED=true`
- [ ] Set `CORS_ORIGIN` to your frontend domain
- [ ] Set `NODE_ENV=production`
- [ ] Connect real database (replace mock data in `dataService.js`)
- [ ] Add Redis caching layer
- [ ] Set up SSL/TLS termination (nginx or cloud LB)
- [ ] Configure monitoring (Datadog, New Relic, etc.)
- [ ] Set up log aggregation
- [ ] Configure CI/CD pipeline

## Connecting Real Data

Replace the mock generators in `src/services/dataService.js`:

```javascript
// BEFORE (mock):
function generateKpis(dashboardId) {
  // ... random data generation
}

// AFTER (real database):
async function generateKpis(dashboardId) {
  const result = await db.query(
    'SELECT * FROM dashboard_kpis WHERE dashboard_id = $1 ORDER BY timestamp DESC LIMIT 1',
    [dashboardId]
  );
  return formatKpiResponse(result.rows[0]);
}
```

---

**Deemona Finance Solution** — Confidential · Proprietary Intelligence Platform · © 2026
