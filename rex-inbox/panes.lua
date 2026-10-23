local TERMINAL = "com.superlogical.terminal"
local SHELL = "com.superlogical.terminal.shell"
local LABEL = "inbox"
local COLUMNS = 36
local MIN_RATIO, MAX_RATIO = 0.1, 0.45

local here = debug.getinfo(1, "S").source:gsub("^@", ""):match("^(.*)/[^/]*$") or "."
local SELF = here .. "/panes.lua"
local INBOX = here .. "/inbox.lua"
local LOCK = (os.getenv("TMPDIR") or "/tmp/"):gsub("/*$", "/") .. "rex-inbox-panes.lock"
local PID_FILE = LOCK .. "/pid"
local STARTING_SECONDS = 10

local function read_pid()
  local f = io.open(PID_FILE, "r")
  if not f then return nil end
  local pid = tonumber(f:read("*l") or "")
  f:close()
  return pid
end

-- True only when `pid` is a running watcher, so a pid reused by another
-- process after a crash or reboot is never mistaken for one.
local function watcher_alive(pid)
  if not pid then return false end
  local r = rex.exec{ "ps", "-o", "command=", "-p", tostring(pid) }
  local command = r and r.ok and r.stdout or ""
  return command:find("panes.lua", 1, true) ~= nil and command:find("watch=true", 1, true) ~= nil
end

local function remove_lock()
  os.remove(PID_FILE)
  os.remove(LOCK)
end

-- mkdir either creates the lock or fails, so two launchers started at once
-- cannot both win.
local function take_lock()
  local made = rex.exec{ "mkdir", LOCK }
  return made ~= nil and made.ok
end

-- A lock with no pid yet belongs to a launcher that is starting a watcher,
-- unless it is older than a launcher could take.
local function lock_is_stale()
  local pid = read_pid()
  if pid then return not watcher_alive(pid) end
  local st = rex.exec{ "stat", "-f", "%m", LOCK }
  local mtime = st and st.ok and tonumber((st.stdout:gsub("%s+", "")))
  return mtime == nil or os.time() - mtime > STARTING_SECONDS
end

if rex.args.stop then
  local pid = read_pid()
  if watcher_alive(pid) then rex.exec{ "kill", tostring(pid) } end
  remove_lock()
  return "inbox panes stopped"
end

if not rex.args.watch then
  if not take_lock() then
    if not lock_is_stale() then return "inbox panes already running" end
    remove_lock()
    if not take_lock() then return "inbox panes already running" end
  end
  local where = rex.exec{ "sh", "-c", "command -v rex" }
  local rex_bin = where and where.ok and where.stdout:gsub("%s+$", "") or "rex"
  local h, err = rex.exec.start({
    "sh", "-c", 'exec "$1" do "$2" --all watch=true rex="$1" >/dev/null 2>&1 </dev/null',
    "sh", rex_bin, SELF,
  }, { detach = true })
  if not h then
    remove_lock()
    error(err, 0)
  end
  local f = io.open(PID_FILE, "w")
  if not f then
    rex.exec{ "kill", tostring(h.pid) }
    remove_lock()
    error("cannot write " .. PID_FILE, 0)
  end
  f:write(h.pid, "\n")
  f:close()
  return "inbox panes on; stop with: rex do " .. SELF .. " stop=true"
end

local REX = rex.args.rex or "rex"

local function each_block(node, fn)
  if not node then return end
  if node.block_id then fn(node.block_id, node.rect) end
  if node.split then
    each_block(node.split.before, fn)
    each_block(node.split.after, fn)
  end
end

local function has_inbox(window)
  for _, layer in ipairs(window.layers or {}) do
    for _, b in ipairs(layer.blocks or {}) do
      if b.label == LABEL then return true end
    end
  end
  return false
end

local function only_inbox(window)
  local inbox, other = false, false
  for _, layer in ipairs(window.layers or {}) do
    for _, b in ipairs(layer.blocks or {}) do
      if b.label == LABEL then inbox = true else other = true end
    end
  end
  return inbox and not other
end

-- Columns per unit of window width, from blocks in `layout` whose size
-- matches what a client asked for. A tab the app has not shown keeps a
-- default size and has no such block.
local function measure(session_id, layout, skip)
  local columns
  each_block(layout, function(block_id, rect)
    if columns or skip[block_id] or not rect or not rect[3] or rect[3] <= 0 then return end
    local size = rex.block.call(TERMINAL, "size", { session_id = session_id, block_id = block_id })
    local desired = size and type(size.desired) == "table" and size.desired[1]
    if desired and desired.columns == size.columns then
      columns = size.columns / rect[3]
    end
  end)
  return columns
end

local function inbox_ids(window)
  local ids = {}
  for _, layer in ipairs(window.layers or {}) do
    for _, b in ipairs(layer.blocks or {}) do
      if b.label == LABEL then ids[b.block_id] = true end
    end
  end
  return ids
end

local last_columns

-- The tab the app is showing, in the first session an app client is attached
-- to. Its sizes are current.
local function shown_window()
  local clients = rex.call("client.list")
  for _, c in ipairs(clients and clients.clients or {}) do
    if c.info and c.info.kind == "app" then
      for _, session_id in ipairs(c.session_ids or {}) do
        local v = rex.call("session.view", { session_id = session_id })
        for _, w in ipairs(v and v.windows or {}) do
          if w.window_id == v.active_window_id then return session_id, w end
        end
      end
    end
  end
  return nil
end

-- The app window's width in columns. The tab the app is showing gives it
-- best. A hidden tab's sizes are those from when the app last showed it, so
-- the tab about to be split is measured next, while its layout still matches
-- them. The last good reading comes after that.
local function window_columns(session_id, window)
  local shown_session, shown = shown_window()
  local columns = shown and measure(shown_session, shown.layers[1] and shown.layers[1].layout, inbox_ids(shown))
  if not columns then
    local tiled = window.layers and window.layers[1]
    columns = measure(session_id, tiled and tiled.layout, {}) or last_columns
  end
  last_columns = columns or last_columns
  return columns
end

local function ratio_for(session_id, window)
  local columns = window_columns(session_id, window)
  if not columns then return 0.25 end
  return math.max(MIN_RATIO, math.min(MAX_RATIO, COLUMNS / columns))
end

-- Returns true once the window has been dealt with, and false when its
-- layout is not in the view yet.
local function add_pane(session_id, window)
  local tiled = window.layers and window.layers[1]
  local layout = tiled and tiled.layout
  if not layout then return false end
  if has_inbox(window) then return true end
  local anchor = layout.split and layout.split.split_id or layout.block_id
  local edge, left = nil, math.huge
  each_block(layout, function(block_id, rect)
    local x = rect and rect[1] or 0
    if x < left then edge, left = block_id, x end
  end)
  if not anchor or not edge then return false end
  local ratio = ratio_for(session_id, window)
  local made = rex.call("session.new_split", {
    session_id = session_id,
    anchor_id = anchor,
    direction = "horizontal",
    side = "before",
    ratio = ratio,
    focus = false,
    layout = {
      block = {
        flavor = SHELL,
        label = LABEL,
        options = { command = { REX, "do", INBOX, "--all" } },
      },
    },
  })
  -- new_split ignores ratio when the anchor is a single block, and in the
  -- window the app is showing, a resize sent at once does not always hold.
  local inbox = made and made.block_ids and made.block_ids[1]
  if inbox then
    local function resize()
      rex.call("session.resize_pane", {
        session_id = session_id,
        before_block_id = inbox,
        after_block_id = edge,
        direction = "horizontal",
        ratio = ratio,
      })
    end
    resize()
    rex.after(0.5, resize)
  end
  return true
end

local function view(session_id)
  return rex.call("session.view", { session_id = session_id })
end

-- Windows already given a pane, or that had one. A window whose inbox the
-- user closes stays in this set, so it is not given another.
local handled = {}

local function fill_session(session_id)
  local v = view(session_id)
  for _, window in ipairs(v and v.windows or {}) do
    if not handled[window.window_id] and add_pane(session_id, window) then
      handled[window.window_id] = true
    end
  end
end

-- A new window's layout may not be in the view yet when its event arrives.
local function fill_soon(session_id)
  for _, delay in ipairs({ 0.3, 1, 3 }) do
    rex.after(delay, function() fill_session(session_id) end)
  end
end

local function close_empty_windows(session_id)
  local v = view(session_id)
  for _, window in ipairs(v and v.windows or {}) do
    if only_inbox(window) then
      rex.call("session.close_window", { session_id = session_id, window_id = window.window_id })
    end
  end
end

rex.on("window_created", function(ctx, ev)
  fill_soon(ctx.session_id)
end)

-- A new session's first window arrives with session_created, not
-- window_created.
rex.on("session_created", function(ctx, ev)
  local session_id = ev.session and ev.session.session_id or ev.session_id or ctx.session_id
  if session_id then fill_soon(session_id) end
end)

rex.on("block_closed", function(ctx, ev)
  local session_id = ctx.session_id
  rex.after(0.3, function() close_empty_windows(session_id) end)
end)

-- Under --all, calls into other sessions fail until the top level returns.
rex.after(0, function()
  local list = rex.call("session.list")
  for _, s in ipairs(list and list.sessions or {}) do fill_session(s.session_id) end
end)
