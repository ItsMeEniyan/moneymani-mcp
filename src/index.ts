import type { Tool } from "@modelcontextprotocol/sdk/types.js"

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

interface Env {
  MONEYMANI_API_URL: string
  MCP_API_KEY: string
}

// ---------------------------------------------------------------------------
// MCP protocol types (JSON-RPC 2.0)
// ---------------------------------------------------------------------------

interface MCPRequest {
  jsonrpc: "2.0"
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

interface MCPResponse {
  jsonrpc: "2.0"
  id?: string | number | null
  result?: unknown
  error?: { code: number; message: string }
}

// ---------------------------------------------------------------------------
// Tool catalogue
// ---------------------------------------------------------------------------

const TOOLS: Tool[] = [
  {
    name: "add_transaction",
    description:
      "Add an income, expense, or savings transaction. Income categories: Salary, Share Dividends, Bond Repayments, Freelance, Other. Expense categories: Food, Family, Travel, Petrol, Rent, Utilities, Entertainment, Healthcare, Shopping, Education, Other. Savings categories: Stocks, Mutual Funds, Fixed Deposits, Gold, Other Savings.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["INCOME", "EXPENSE", "SAVINGS"] },
        category: { type: "string" },
        amount: { type: "number", description: "Amount in INR (positive)" },
        month: { type: "string", description: "YYYY-MM format, defaults to current month" },
        note: { type: "string" },
      },
      required: ["type", "category", "amount"],
    },
  },
  {
    name: "list_transactions",
    description: "List transactions with optional filters. Returns type, category, amount, month, note.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["INCOME", "EXPENSE", "SAVINGS"] },
        category: { type: "string" },
        month: { type: "string", description: "YYYY-MM format" },
        limit: { type: "number", description: "Max results (default 50, max 200)" },
      },
    },
  },
  {
    name: "delete_transaction",
    description: "Delete a transaction by ID. Use list_transactions to find the ID first.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "get_monthly_summary",
    description: "Get income, expenses, savings, net cash flow, and top expense categories for a month.",
    inputSchema: {
      type: "object",
      properties: {
        month: { type: "string", description: "YYYY-MM format, defaults to current month" },
      },
    },
  },
  {
    name: "get_net_worth",
    description: "Get net worth: total cumulative savings minus total liabilities.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_trip",
    description: "Create a new trip to track expenses.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "e.g. Goa Trip, Ooty Weekend" } },
      required: ["name"],
    },
  },
  {
    name: "list_trips",
    description: "List all trips (active and completed) with total spend and expense count.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_trip",
    description: "Get trip details: all expenses and category breakdown with percentages.",
    inputSchema: {
      type: "object",
      properties: { trip_id: { type: "string" } },
      required: ["trip_id"],
    },
  },
  {
    name: "add_trip_expense",
    description:
      "Add an expense to an active trip. Categories: Food, Accommodation, Transport, Petrol, Tickets & Entry, Shopping, Other.",
    inputSchema: {
      type: "object",
      properties: {
        trip_id: { type: "string" },
        category: { type: "string" },
        amount: { type: "number" },
        note: { type: "string" },
      },
      required: ["trip_id", "category", "amount"],
    },
  },
  {
    name: "end_trip",
    description: "Mark a trip as completed (no more expenses can be added).",
    inputSchema: {
      type: "object",
      properties: { trip_id: { type: "string" } },
      required: ["trip_id"],
    },
  },
  {
    name: "add_liability",
    description: "Add a liability (loan, credit card, etc.) that reduces net worth.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "e.g. Car Loan, Credit Card" },
        amount: { type: "number", description: "Outstanding amount in INR" },
      },
      required: ["name", "amount"],
    },
  },
  {
    name: "list_liabilities",
    description: "List all liabilities with individual amounts and total.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "delete_liability",
    description: "Delete a liability by ID. Use list_liabilities or get_net_worth to find the ID.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
]

// ---------------------------------------------------------------------------
// API helper — all calls go through the MoneyMani Vercel app
// ---------------------------------------------------------------------------

type ApiResponse = Record<string, unknown>

async function api(
  env: Env,
  method: string,
  path: string,
  body?: unknown
): Promise<ApiResponse> {
  const url = `${env.MONEYMANI_API_URL.replace(/\/$/, "")}/api/mcp${path}`
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.MCP_API_KEY}`,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
  const data = (await res.json()) as ApiResponse
  if (!res.ok) throw new Error((data.error as string | undefined) ?? `HTTP ${res.status}`)
  return data
}

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

// ---------------------------------------------------------------------------
// Tool handlers — thin wrappers over the Next.js REST API
// ---------------------------------------------------------------------------

type Args = Record<string, unknown>

async function addTransaction(args: Args, env: Env): Promise<string> {
  const month = (args.month as string | undefined) ?? currentMonth()
  const { message } = await api(env, "POST", "/transactions", {
    type: args.type,
    category: args.category,
    amount: args.amount,
    month,
    note: args.note ?? null,
  })
  return (message as string) ?? "Transaction added."
}

async function listTransactions(args: Args, env: Env): Promise<string> {
  const params = new URLSearchParams()
  if (args.type) params.set("type", args.type as string)
  if (args.category) params.set("category", args.category as string)
  if (args.month) params.set("month", args.month as string)
  if (args.limit) params.set("limit", String(args.limit))
  const qs = params.toString()
  const { message } = await api(env, "GET", `/transactions${qs ? `?${qs}` : ""}`)
  return (message as string) ?? "No transactions found."
}

async function deleteTransaction(args: Args, env: Env): Promise<string> {
  const { message } = await api(env, "DELETE", `/transactions/${args.id}`)
  return (message as string) ?? "Transaction deleted."
}

async function getMonthlySummary(args: Args, env: Env): Promise<string> {
  const month = (args.month as string | undefined) ?? currentMonth()
  const { message } = await api(env, "GET", `/summary?month=${month}`)
  return (message as string) ?? "Summary retrieved."
}

async function getNetWorth(env: Env): Promise<string> {
  const { message } = await api(env, "GET", "/networth")
  return (message as string) ?? "Net worth retrieved."
}

async function createTrip(args: Args, env: Env): Promise<string> {
  const data = await api(env, "POST", "/trips", { name: args.name })
  const msg = (data.message as string) ?? `Trip created.`
  const tripId = data.tripId as string | undefined
  return tripId ? `${msg}\nTrip ID: ${tripId}` : msg
}

async function listTrips(env: Env): Promise<string> {
  const { message } = await api(env, "GET", "/trips")
  return (message as string) ?? "No trips found."
}

async function getTrip(args: Args, env: Env): Promise<string> {
  const { message } = await api(env, "GET", `/trips/${args.trip_id}`)
  return (message as string) ?? "Trip retrieved."
}

async function addTripExpense(args: Args, env: Env): Promise<string> {
  const { message } = await api(env, "POST", `/trips/${args.trip_id}/expenses`, {
    category: args.category,
    amount: args.amount,
    note: args.note ?? null,
  })
  return (message as string) ?? "Expense added."
}

async function endTrip(args: Args, env: Env): Promise<string> {
  const { message } = await api(env, "PATCH", `/trips/${args.trip_id}/end`)
  return (message as string) ?? "Trip ended."
}

async function addLiability(args: Args, env: Env): Promise<string> {
  const { message } = await api(env, "POST", "/liabilities", {
    name: args.name,
    amount: args.amount,
  })
  return (message as string) ?? "Liability added."
}

async function listLiabilities(env: Env): Promise<string> {
  const { message } = await api(env, "GET", "/liabilities")
  return (message as string) ?? "No liabilities found."
}

async function deleteLiability(args: Args, env: Env): Promise<string> {
  const { message } = await api(env, "DELETE", `/liabilities/${args.id}`)
  return (message as string) ?? "Liability deleted."
}

// ---------------------------------------------------------------------------
// Tool dispatcher
// ---------------------------------------------------------------------------

async function callTool(name: string, args: Args, env: Env): Promise<string> {
  switch (name) {
    case "add_transaction":    return addTransaction(args, env)
    case "list_transactions":  return listTransactions(args, env)
    case "delete_transaction": return deleteTransaction(args, env)
    case "get_monthly_summary": return getMonthlySummary(args, env)
    case "get_net_worth":      return getNetWorth(env)
    case "create_trip":        return createTrip(args, env)
    case "list_trips":         return listTrips(env)
    case "get_trip":           return getTrip(args, env)
    case "add_trip_expense":   return addTripExpense(args, env)
    case "end_trip":           return endTrip(args, env)
    case "add_liability":      return addLiability(args, env)
    case "list_liabilities":   return listLiabilities(env)
    case "delete_liability":   return deleteLiability(args, env)
    default: throw new Error(`Unknown tool: ${name}`)
  }
}

// ---------------------------------------------------------------------------
// MCP JSON-RPC 2.0 handler
// ---------------------------------------------------------------------------

async function handleMCP(req: MCPRequest, env: Env): Promise<MCPResponse> {
  const ok = (result: unknown): MCPResponse => ({ jsonrpc: "2.0", id: req.id, result })
  const err = (code: number, message: string): MCPResponse => ({
    jsonrpc: "2.0",
    id: req.id,
    error: { code, message },
  })

  try {
    switch (req.method) {
      case "initialize":
        return ok({
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "MoneyMani", version: "2.0.0" },
        })

      case "notifications/initialized":
      case "initialized":
      case "ping":
        return ok({})

      case "tools/list":
        return ok({ tools: TOOLS })

      case "tools/call": {
        const { name, arguments: args = {} } = req.params as {
          name: string
          arguments?: Args
        }
        const text = await callTool(name, args, env)
        return ok({ content: [{ type: "text", text }] })
      }

      default:
        return err(-32601, `Method not found: ${req.method}`)
    }
  } catch (e) {
    return err(-32000, e instanceof Error ? e.message : "Internal error")
  }
}

// ---------------------------------------------------------------------------
// Cloudflare Worker entry point
// ---------------------------------------------------------------------------

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id",
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS })

    const url = new URL(request.url)

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return Response.json(
        { name: "MoneyMani MCP Server", version: "2.0.0", protocol: "2024-11-05", status: "ok" },
        { headers: CORS }
      )
    }

    // Auth — the same MCP_API_KEY is forwarded to the Next.js API
    const auth = request.headers.get("Authorization") ?? ""
    if (auth !== `Bearer ${env.MCP_API_KEY}`) {
      return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS })
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS })
    }

    let body: MCPRequest
    try {
      body = await request.json()
    } catch {
      return Response.json(
        { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
        { status: 400, headers: { "Content-Type": "application/json", ...CORS } }
      )
    }

    const response = await handleMCP(body, env)
    return Response.json(response, { headers: { "Content-Type": "application/json", ...CORS } })
  },
}
