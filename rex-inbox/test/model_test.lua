local dir = (arg and arg[0] or ""):match("^(.*)/test/[^/]*$") or ".."
package.path = dir .. "/?.lua;" .. package.path

local M = require("model")

local function eq(got, want, what)
  if got ~= want then
    error(string.format("%s: got %q, want %q", what, tostring(got), tostring(want)), 2)
  end
end

-- 2026-10-23T10:00:00Z
local NOW = 1792749600

local function rec(state, at, extra)
  local r = { state = state, app = "claude-code", effective_app = "claude-code", updated_at = at }
  for k, v in pairs(extra or {}) do r[k] = v end
  return r
end

-- parse_time reads the UTC offset
eq(M.parse_time("2026-10-23T06:00:00-04:00"), NOW, "offset -04:00")
eq(M.parse_time("2026-10-23T10:00:00Z"), NOW, "Z suffix")
eq(M.parse_time("2026-10-23T11:30:00+01:30"), NOW, "offset +01:30")
eq(math.floor(M.parse_time("2026-10-23T06:04:53.011571-04:00")), NOW + 293, "fractional seconds")
eq(M.parse_time("garbage"), nil, "bad timestamp")

-- age from an offset timestamp
eq(M.age("2026-10-23T05:59:48-04:00", NOW), "12s", "seconds")
eq(M.age("2026-10-23T05:57:00-04:00", NOW), "3m", "minutes")
eq(M.age("2026-10-23T08:00:00Z", NOW), "2h", "hours")
eq(M.age("2026-10-19T10:00:00Z", NOW), "4d", "days")
eq(M.age("2026-10-23T10:00:05Z", NOW), "0s", "clock skew clamps to zero")
eq(M.age(nil, NOW), "", "missing timestamp")

-- folder from a file:// URL or a plain path
eq(M.folder("file://mac.local/Users/me/Code/moot"), "moot", "file URL")
eq(M.folder("file://mac.local/Users/me/Code/moot-rex-inbox/"), "moot-rex-inbox", "trailing slash")
eq(M.folder("file:///Users/me/My%20Repo"), "My Repo", "percent-encoded")
eq(M.folder("/Users/me/Code/moot"), "moot", "plain path")
eq(M.folder("file://host/"), "/", "root")
eq(M.folder(nil), "", "missing")
eq(M.folder(""), "", "empty")

-- pick: most urgent record wins (item 6)
local working = rec("working", "2026-10-23T09:59:00Z")
local blocked = rec("blocked", "2026-10-23T09:58:00Z", { id = "sub" })
local idle = rec("idle", "2026-10-23T09:59:30Z")
eq(M.pick({ working, blocked, idle }), blocked, "blocked beats working and idle")
eq(M.pick({ idle, working }), working, "working beats idle")
eq(M.pick({ rec("error", "2026-10-23T09:00:00Z"), rec("done", "2026-10-23T09:00:00Z") }).state, "error", "error beats done")

-- pick: tie-breaks follow the sort order
local old_done = rec("done", "2026-10-23T09:00:00Z")
local new_done = rec("done", "2026-10-23T09:30:00Z")
eq(M.pick({ new_done, old_done }), old_done, "oldest done wins")
local old_work = rec("working", "2026-10-23T09:00:00Z")
local new_work = rec("working", "2026-10-23T09:30:00Z")
eq(M.pick({ old_work, new_work }), new_work, "newest working wins")

-- pick: app filter on and off (items 2, 12)
local cargo = { state = "blocked", app = "cargo", effective_app = "cargo", updated_at = "2026-10-23T09:00:00Z" }
local inherited = { state = "done", effective_app = "claude-code", updated_at = "2026-10-23T09:00:00Z" }
eq(M.pick({ cargo }), nil, "other apps are skipped by default")
eq(M.pick({ cargo, idle }), idle, "claude-code record kept when another app is more urgent")
eq(M.pick({ cargo, idle }, true), cargo, "all=true keeps every app")
eq(M.pick({ inherited }), inherited, "effective_app counts")
eq(M.pick({ { state = "working", app = "claude-code", updated_at = "2026-10-23T09:00:00Z" } }).state, "working", "app without effective_app")
eq(M.pick({ { state = "bogus", app = "claude-code" } }), nil, "unknown state skipped")
eq(M.pick({}), nil, "no records")
eq(M.pick(nil), nil, "nil records")

-- sort order and tie-breaks (item 4)
local function row(name, state, at)
  return { session = name, folder = "f", title = "t", record = rec(state, at) }
end
local rows = M.sort({
  row("idle-old", "idle", "2026-10-23T09:00:00Z"),
  row("work-old", "working", "2026-10-23T09:00:00Z"),
  row("done-new", "done", "2026-10-23T09:50:00Z"),
  row("idle-new", "idle", "2026-10-23T09:50:00Z"),
  row("block-new", "blocked", "2026-10-23T09:50:00Z"),
  row("err", "error", "2026-10-23T09:10:00Z"),
  row("work-new", "working", "2026-10-23T09:50:00Z"),
  row("done-old", "done", "2026-10-23T09:00:00Z"),
  row("block-old", "blocked", "2026-10-23T09:00:00Z"),
})
local order = {}
for i, r in ipairs(rows) do order[i] = r.session end
eq(table.concat(order, ","),
  "block-old,block-new,err,done-old,done-new,work-new,work-old,idle-new,idle-old",
  "sort order")

-- header counts (item 10)
eq(M.counts({
  row("a", "working", "2026-10-23T09:00:00Z"),
  row("b", "blocked", "2026-10-23T09:00:00Z"),
  row("c", "done", "2026-10-23T09:00:00Z"),
  row("d", "working", "2026-10-23T09:00:00Z"),
  row("e", "blocked", "2026-10-23T09:00:00Z"),
}), "2 blocked · 1 done · 2 working", "counts")
eq(M.counts({}), "no agents", "counts with no rows")

-- render: kind shown for blocked (item 5), every field present (item 3)
local function blocked_row(kind)
  return {
    session = "api-work",
    folder = "moot-rex-inbox",
    title = "fix login",
    record = rec("blocked", "2026-10-23T09:57:00Z", { kind = kind, msg = "approve Bash: rm x" }),
  }
end
local lines = M.render({ blocked_row("permission") }, 200, NOW)
eq(#lines, 2, "header plus one row")
eq(lines[1], "1 blocked", "header line")
local line = lines[2]
for _, part in ipairs({ "api-work", "moot-rex-inbox", "fix login", "permission", "approve Bash: rm x", "3m" }) do
  assert(line:find(part, 1, true), "row is missing " .. part .. ": " .. line)
end
assert(not M.render({ blocked_row(nil) }, 200, NOW)[2]:find("permission", 1, true), "no kind when the record has none")
local done_row = { session = "s", folder = "f", title = "t", record = rec("done", "2026-10-23T09:57:00Z", { kind = "permission" }) }
assert(not M.render({ done_row }, 200, NOW)[2]:find("permission", 1, true), "kind only for blocked")

-- render: each state has a distinct symbol at the start of the row
local seen = {}
for _, state in ipairs(M.STATES) do
  local sym = M.render({ row("s", state, "2026-10-23T09:00:00Z") }, 80, NOW)[2]:match("^(%S+)")
  assert(sym and not seen[sym], "symbol for " .. state)
  seen[sym] = true
end

-- render: lines cut to width (item 11), counted in characters, not bytes
local long = {
  session = "session-é", folder = "folder", title = "a title",
  record = rec("working", "2026-10-23T09:59:00Z", { msg = string.rep("ü", 300) }),
}
for _, width in ipairs({ 80, 40, 10 }) do
  for _, l in ipairs(M.render({ long, blocked_row("question") }, width, NOW)) do
    assert(M.width(l) <= width, string.format("line longer than %d: %q", width, l))
  end
end
eq(M.width("ab"), 2, "ascii width")
eq(M.width("üé"), 2, "utf-8 width")
eq(M.width("日本"), 4, "wide characters take two columns")
assert(M.width(M.render({ long }, 40, NOW)[2]) == 40, "a long row fills the width")

-- render: control characters never reach the terminal
local evil = { session = "s", folder = "f", title = "x\27[2Jy", record = rec("idle", "2026-10-23T09:00:00Z", { msg = "a\nb" }) }
local evil_line = M.render({ evil }, 200, NOW)[2]
assert(not evil_line:find("[%c]"), "control characters stripped: " .. evil_line)

-- render: color wraps only the symbol and keeps the visible width
local colored = M.render({ long }, 40, NOW, true)[2]
assert(colored:find("\27%["), "color adds escapes")
eq(M.width(colored:gsub("\27%[[%d;]*m", "")), 40, "colored row keeps width")

print("ok")
