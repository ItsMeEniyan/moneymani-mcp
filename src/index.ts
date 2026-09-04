import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Tool } from "@modelcontextprotocol/sdk/types.js"

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  USER_EMAIL: string
  MCP_AUTH_KEY?: string
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
// Tool catalogue (matches MCP spec — camelCase inputSchema)
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
    description: "List transactions with optional filters. Returns ID, type, category, amount, month, note.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["INCOME", "EXPENSE", "SAVINGS"] },
        category: { type: "string" },
        month: { type: "string", description: "YYYY-MM format" },
        limit: { type: "number", description: "Max results (default 20, max 100)" },
      },
    },
  },
  {
    name: "delete_transaction",
    description: "Delete a transaction by ID.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "get_monthly_summary",
    description: "Get income, expenses, savings, and net cash flow for a month.",
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
    description: "Delete a liability by ID.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
}

function monthRange(ym: string): { start: string; end: string } {
  const [y, m] = ym.split("-").map(Number)
  return {
    start: new Date(y, m - 1, 1).toISOString(),
    end: new Date(y, m, 0, 23, 59, 59, 999).toISOString(),
  }
}

async function getUserId(db: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await db.from("User").select("id").eq("email", email).single()
  if (error || !data) throw new Error(`User not found: ${email}. Check USER_EMAIL env var.`)
  return data.id
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

type Args = Record<string, unknown>

async function addTransaction(args: Args, db: SupabaseClient, uid: string): Promise<string> {
  const month = (args.month as string | undefined) ?? currentMonth()
  const { error } = await db.from("Transaction").insert({
    userId: uid,
    type: args.type,
    category: args.category,
    amount: args.amount,
    date: new Date(`${month}-01`).toISOString(),
    note: args.note ?? null,
    createdAt: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
  return `Added ${args.type} · ${args.category} · ${formatINR(args.amount as number)} · ${month}`
}

async function listTransactions(args: Args, db: SupabaseClient, uid: string): Promise<string> {
  let q = db
    .from("Transaction")
    .select("id, type, category, amount, date, note")
    .eq("userId", uid)
    .order("date", { ascending: false })
    .limit(Math.min((args.limit as number | undefined) ?? 20, 100))

  if (args.type) q = q.eq("type", args.type)
  if (args.category) q = q.eq("category", args.category)
  if (args.month) {
    const { start, end } = monthRange(args.month as string)
    q = q.gte("date", start).lte("date", end)
  }

  const { data, error } = await q
  if (error) throw new Error(error.message)
  if (!data?.length) return "No transactions found."

  return data
    .map((t) => {
      const mon = new Date(t.date).toLocaleDateString("en-IN", { month: "short", year: "numeric" })
      const sign = t.type === "INCOME" ? "+" : t.type === "SAVINGS" ? "→" : "-"
      return `[${t.id}] ${sign}${formatINR(t.amount)} | ${t.type} | ${t.category} | ${mon}${t.note ? ` | ${t.note}` : ""}`
    })
    .join("\n")
}

async function deleteTransaction(args: Args, db: SupabaseClient, uid: string): Promise<string> {
  const { error } = await db.from("Transaction").delete().eq("id", args.id).eq("userId", uid)
  if (error) throw new Error(error.message)
  return "Transaction deleted."
}

async function getMonthlySummary(args: Args, db: SupabaseClient, uid: string): Promise<string> {
  const ym = (args.month as string | undefined) ?? currentMonth()
  const { start, end } = monthRange(ym)
  const { data, error } = await db
    .from("Transaction")
    .select("type, amount")
    .eq("userId", uid)
    .gte("date", start)
    .lte("date", end)

  if (error) throw new Error(error.message)
  const rows = data ?? []
  const sum = (type: string) =>
    rows.filter((r) => r.type === type).reduce((s, r) => s + Number(r.amount), 0)

  const income = sum("INCOME")
  const expenses = sum("EXPENSE")
  const savings = sum("SAVINGS")
  const cash = income - expenses
  const [y, m] = ym.split("-").map(Number)
  const label = new Date(y, m - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" })

  return [
    `📊 ${label}`,
    `Income:    ${formatINR(income)}`,
    `Expenses:  ${formatINR(expenses)}`,
    `Savings:   ${formatINR(savings)}`,
    `Cash Flow: ${cash >= 0 ? "+" : ""}${formatINR(cash)}`,
  ].join("\n")
}

async function getNetWorth(db: SupabaseClient, uid: string): Promise<string> {
  const [{ data: sav }, { data: liab }] = await Promise.all([
    db.from("Transaction").select("amount").eq("userId", uid).eq("type", "SAVINGS"),
    db.from("Liability").select("name, amount, id").eq("userId", uid),
  ])
  const assets = (sav ?? []).reduce((s, r) => s + Number(r.amount), 0)
  const liabilities = (liab ?? []).reduce((s, r) => s + Number(r.amount), 0)
  const net = assets - liabilities
  const liabLines = (liab ?? [])
    .map((l) => `  [${l.id}] ${l.name}: ${formatINR(l.amount)}`)
    .join("\n")

  return [
    `💰 Net Worth: ${formatINR(net)}`,
    `Assets (total savings): ${formatINR(assets)}`,
    `Liabilities total:      ${formatINR(liabilities)}`,
    liabLines ? `\nLiabilities:\n${liabLines}` : "",
  ]
    .filter(Boolean)
    .join("\n")
}

async function createTrip(args: Args, db: SupabaseClient, uid: string): Promise<string> {
  const { data, error } = await db
    .from("Trip")
    .insert({ userId: uid, name: args.name, status: "ACTIVE", createdAt: new Date().toISOString() })
    .select("id")
    .single()
  if (error) throw new Error(error.message)
  return `Trip "${args.name}" created.\nTrip ID: ${data.id}\nUse this ID to add expenses.`
}

async function listTrips(db: SupabaseClient, uid: string): Promise<string> {
  const { data, error } = await db
    .from("Trip")
    .select("id, name, status, expenses:TripExpense(amount)")
    .eq("userId", uid)
    .order("createdAt", { ascending: false })
  if (error) throw new Error(error.message)
  if (!data?.length) return "No trips yet."

  return (data as Array<{ id: string; name: string; status: string; expenses: Array<{ amount: number }> }>)
    .map((t) => {
      const total = t.expenses?.reduce((s, e) => s + Number(e.amount), 0) ?? 0
      return `[${t.id}] ${t.name} | ${t.status} | ${formatINR(total)} | ${t.expenses?.length ?? 0} expenses`
    })
    .join("\n")
}

async function getTrip(args: Args, db: SupabaseClient, uid: string): Promise<string> {
  const { data: trip, error: te } = await db
    .from("Trip")
    .select("name, status")
    .eq("id", args.trip_id)
    .eq("userId", uid)
    .single()
  if (te || !trip) throw new Error("Trip not found.")

  const { data: exps, error: ee } = await db
    .from("TripExpense")
    .select("id, category, amount, note")
    .eq("tripId", args.trip_id)
    .order("createdAt", { ascending: false })
  if (ee) throw new Error(ee.message)

  const rows = exps ?? []
  const total = rows.reduce((s, e) => s + Number(e.amount), 0)
  const catMap = new Map<string, number>()
  for (const e of rows) catMap.set(e.category, (catMap.get(e.category) ?? 0) + Number(e.amount))

  const breakdown = Array.from(catMap.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => `  ${cat}: ${formatINR(amt)} (${total > 0 ? ((amt / total) * 100).toFixed(0) : 0}%)`)

  const expLines = rows.map(
    (e) => `  [${e.id}] ${e.category}: ${formatINR(e.amount)}${e.note ? ` — ${e.note}` : ""}`
  )

  return [
    `✈️ ${trip.name} [${trip.status}]`,
    `Total: ${formatINR(total)} across ${rows.length} expense${rows.length !== 1 ? "s" : ""}`,
    "\nBy category:",
    ...breakdown,
    `\nExpenses:`,
    ...(expLines.length ? expLines : ["  None yet."]),
  ].join("\n")
}

async function addTripExpense(args: Args, db: SupabaseClient, uid: string): Promise<string> {
  const { data: trip, error: te } = await db
    .from("Trip")
    .select("name, status")
    .eq("id", args.trip_id)
    .eq("userId", uid)
    .single()
  if (te || !trip) throw new Error("Trip not found.")
  if (trip.status === "COMPLETED") throw new Error("Cannot add expenses to a completed trip.")

  const { error } = await db.from("TripExpense").insert({
    tripId: args.trip_id,
    category: args.category,
    amount: args.amount,
    note: args.note ?? null,
    createdAt: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
  return `Added ${args.category}: ${formatINR(args.amount as number)} to "${trip.name}".`
}

async function endTrip(args: Args, db: SupabaseClient, uid: string): Promise<string> {
  const { error } = await db
    .from("Trip")
    .update({ status: "COMPLETED" })
    .eq("id", args.trip_id)
    .eq("userId", uid)
  if (error) throw new Error(error.message)
  return "Trip marked as completed."
}

async function addLiability(args: Args, db: SupabaseClient, uid: string): Promise<string> {
  const { error } = await db.from("Liability").insert({
    userId: uid,
    name: args.name,
    amount: args.amount,
    updatedAt: new Date().toISOString(),
  })
  if (error) throw new Error(error.message)
  return `Liability "${args.name}" added: ${formatINR(args.amount as number)}.`
}

async function listLiabilities(db: SupabaseClient, uid: string): Promise<string> {
  const { data, error } = await db
    .from("Liability")
    .select("id, name, amount")
    .eq("userId", uid)
    .order("updatedAt", { ascending: false })
  if (error) throw new Error(error.message)
  if (!data?.length) return "No liabilities."
  const total = data.reduce((s, l) => s + Number(l.amount), 0)
  return [...data.map((l) => `[${l.id}] ${l.name}: ${formatINR(l.amount)}`), `\nTotal: ${formatINR(total)}`].join("\n")
}

async function deleteLiability(args: Args, db: SupabaseClient, uid: string): Promise<string> {
  const { error } = await db.from("Liability").delete().eq("id", args.id).eq("userId", uid)
  if (error) throw new Error(error.message)
  return "Liability deleted."
}

// ---------------------------------------------------------------------------
// Tool dispatcher
// ---------------------------------------------------------------------------

async function callTool(name: string, args: Args, db: SupabaseClient, uid: string): Promise<string> {
  switch (name) {
    case "add_transaction":    return addTransaction(args, db, uid)
    case "list_transactions":  return listTransactions(args, db, uid)
    case "delete_transaction": return deleteTransaction(args, db, uid)
    case "get_monthly_summary": return getMonthlySummary(args, db, uid)
    case "get_net_worth":      return getNetWorth(db, uid)
    case "create_trip":        return createTrip(args, db, uid)
    case "list_trips":         return listTrips(db, uid)
    case "get_trip":           return getTrip(args, db, uid)
    case "add_trip_expense":   return addTripExpense(args, db, uid)
    case "end_trip":           return endTrip(args, db, uid)
    case "add_liability":      return addLiability(args, db, uid)
    case "list_liabilities":   return listLiabilities(db, uid)
    case "delete_liability":   return deleteLiability(args, db, uid)
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
          serverInfo: { name: "MoneyMani", version: "1.0.0" },
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
        const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
        const uid = await getUserId(db, env.USER_EMAIL)
        const text = await callTool(name, args, db, uid)
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

    // Health / info
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return Response.json(
        { name: "MoneyMani MCP Server", version: "1.0.0", protocol: "2024-11-05", status: "ok" },
        { headers: CORS }
      )
    }

    // Auth
    if (env.MCP_AUTH_KEY) {
      const auth = request.headers.get("Authorization") ?? ""
      if (auth !== `Bearer ${env.MCP_AUTH_KEY}`) {
        return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS })
      }
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
