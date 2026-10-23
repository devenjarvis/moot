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
-- render: a session header, then two lines per agent (items 3, 5)
local lines, keys = M.render({ blocked_row("permission") }, 40, NOW)
eq(lines[1], "1 blocked", "counts line")
eq(lines[2], "▲ api-work · moot-rex-inbox", "session header with its folder")
eq(lines[3], "  1 ▲ fix login                       3m", "agent line with key, title, and age")
eq(lines[4], "      [permission] approve Bash: rm x", "message line with kind")
eq(#lines, 4, "no other lines")
eq(keys[1].title, "fix login", "key 1 maps to the row's title")
assert(not table.concat(M.render({ blocked_row(nil) }, 80, NOW), "\n"):find("[", 1, true), "no kind when the record has none")
local done_row = { session = "s", folder = "f", title = "t", record = rec("done", "2026-10-23T09:57:00Z", { kind = "permission", msg = "m" }) }
assert(not table.concat(M.render({ done_row }, 80, NOW), "\n"):find("permission", 1, true), "kind only for blocked")
local quiet = { session = "s", folder = "f", title = "t", record = rec("idle", "2026-10-23T09:57:00Z") }
eq(#M.render({ quiet }, 80, NOW), 3, "no message line without a message")
local untitled = { session = "s", folder = "f", title = "", record = rec("working", "2026-10-23T09:57:00Z", { msg = "Running tests" }) }
local ul = M.render({ untitled }, 30, NOW)
eq(ul[3], "  1 ◷ Running tests         3m", "message moves up when there is no title")
eq(#ul, 3, "untitled agent takes one line")

-- render: groups by session, most urgent group first, rows by urgency inside
local function srow(session, folder, title, state, at)
  return { session = session, session_id = "id-" .. session, folder = folder, title = title, record = rec(state, at) }
end
local grouped, gkeys = M.render({
  srow("docs", "moot", "readme", "done", "2026-10-23T09:50:00Z"),
  srow("api", "app", "refactor", "working", "2026-10-23T09:59:00Z"),
  srow("api", "app", "login", "blocked", "2026-10-23T09:57:00Z"),
  srow("ops", "infra", "deploy", "idle", "2026-10-23T09:00:00Z"),
}, 30, NOW)
local heads, order = {}, {}
for _, l in ipairs(grouped) do
  if l:match("^%S") and not l:match("^%d") then heads[#heads + 1] = l end
end
eq(table.concat(heads, "|"), "▲ api · app|✓ docs · moot|○ ops · infra", "groups by most urgent agent")
for i = 1, 4 do order[i] = gkeys[i].title end
eq(table.concat(order, ","), "login,refactor,readme,deploy", "keys follow the drawn order")
eq(grouped[#grouped - 2], "", "blank line between groups")

-- render: a session with agents in several folders names the folder per agent
local mixed = M.render({
  srow("api", "app", "login", "blocked", "2026-10-23T09:57:00Z"),
  srow("api", "app-wt", "tests", "working", "2026-10-23T09:59:00Z"),
}, 40, NOW)
eq(mixed[2], "▲ api", "mixed folders leave the header bare")
assert(mixed[3]:find("app · login", 1, true), "folder before title: " .. mixed[3])
assert(mixed[4]:find("app-wt · tests", 1, true), "folder before title: " .. mixed[4])

-- render: sessions with the same label stay apart
local twins = M.render({
  { session = "work", session_id = "id-1", folder = "a", title = "one", record = rec("done", "2026-10-23T09:00:00Z") },
  { session = "work", session_id = "id-2", folder = "b", title = "two", record = rec("done", "2026-10-23T09:10:00Z") },
}, 40, NOW)
eq(twins[2], "✓ work · a", "first session")
eq(twins[5], "✓ work · b", "second session with the same label")

-- render: ties break on block_id, so equal rows keep their order
local function tied(id)
  return { session = "s", block_id = id, folder = "f", title = "t", record = rec("working", "2026-10-23T09:00:00Z") }
end
local _, tkeys = M.render({ tied("block:b"), tied("block:a") }, 40, NOW)
eq(tkeys[1].block_id .. tkeys[2].block_id, "block:ablock:b", "tie-break on block_id")
local _, rkeys = M.render({ tied("block:a"), tied("block:b") }, 40, NOW)
eq(rkeys[1].block_id .. rkeys[2].block_id, "block:ablock:b", "same order from the other input order")

-- render: key_lines gives the line each key's agent starts on
local klines, kkeys, kline = M.render({
  srow("api", "app", "login", "blocked", "2026-10-23T09:57:00Z"),
  srow("docs", "moot", "readme", "done", "2026-10-23T09:50:00Z"),
}, 40, NOW)
eq(kline[1], 3, "key 1 line")
eq(kline[2], 6, "key 2 line after a blank line and a header")
assert(klines[kline[2]]:find("readme", 1, true), "key 2 line holds its agent")

-- render: only nine agents get keys
local many = {}
for i = 1, 11 do many[i] = srow("s", "f", "t" .. i, "working", string.format("2026-10-23T09:%02d:00Z", i)) end
local _, mkeys = M.render(many, 40, NOW)
eq(mkeys[9] ~= nil and mkeys[10] == nil, true, "keys 1 to 9 only")

-- render: each state has a distinct symbol
local seen = {}
for _, state in ipairs(M.STATES) do
  local sym = M.render({ row("s", state, "2026-10-23T09:00:00Z") }, 80, NOW)[2]:match("^(%S+)")
  assert(sym and not seen[sym], "symbol for " .. state)
  seen[sym] = true
end

-- render: lines cut to width (item 11), counted in characters, not bytes
local long = {
  session = "session-é" .. string.rep("x", 60), folder = "folder", title = string.rep("t", 80),
  record = rec("working", "2026-10-23T09:59:00Z", { msg = string.rep("ü", 300) }),
}
for _, width in ipairs({ 80, 40, 10, 3 }) do
  for _, l in ipairs(M.render({ long, blocked_row("question") }, width, NOW)) do
    assert(M.width(l) <= width, string.format("line longer than %d: %q", width, l))
  end
end
eq(M.cut("abcdef", 4), "abc…", "cut adds an ellipsis")
eq(M.cut("abc", 4), "abc", "cut keeps short text")
eq(M.width("ab"), 2, "ascii width")
eq(M.width("üé"), 2, "utf-8 width")
eq(M.width("日本"), 4, "wide characters take two columns")
eq(M.width("✅⭐"), 4, "emoji below U+1F300 take two columns")
eq(M.width("✓✗◷▲○"), 5, "state symbols take one column")
local ll = M.render({ long }, 40, NOW)
eq(M.width(ll[3]), 40, "a long title line fills the width")
assert(ll[3]:find("1m$"), "age survives a long title: " .. ll[3])
eq(M.width(ll[4]), 40, "a long message line fills the width")

-- render: control characters never reach the terminal
local evil = { session = "s\27]0;x\7", folder = "f", title = "x\27[2Jy", record = rec("idle", "2026-10-23T09:00:00Z", { msg = "a\nb" }) }
local evil_kind = { session = "s", folder = "f", title = "", record = rec("blocked", "2026-10-23T09:00:00Z", { kind = "q\27[31m", msg = "m" }) }
for _, l in ipairs(M.render({ evil_kind }, 200, NOW)) do
  assert(not l:find("[%c]"), "control characters stripped from kind: " .. l)
end
eq(M.render({ evil_kind }, 40, NOW)[3], "  1 ▲ [q[31m] m                       1h", "blocked row with no title shows kind and message on one line")
for _, l in ipairs(M.render({ evil }, 200, NOW)) do
  assert(not l:find("[%c]"), "control characters stripped: " .. l)
end

-- render: color wraps only symbols and keeps the visible width
local colored = M.render({ long }, 40, NOW, true)
assert(colored[2]:find("\27%["), "header symbol colored")
assert(colored[3]:find("\27%["), "row symbol colored")
for i = 2, 4 do
  eq(M.width((colored[i]:gsub("\27%[[%d;]*m", ""))), M.width(ll[i]), "colored line " .. i .. " keeps width")
end

print("ok")
