local TERMINAL = "com.superlogical.terminal"
local SHELL = "com.superlogical.terminal.shell"
local LABEL = "inbox"
local COLUMNS = 36
local MIN_RATIO, MAX_RATIO = 0.55, 0.9

local here = debug.getinfo(1, "S").source:gsub("^@", ""):match("^(.*)/[^/]*$") or "."
local SELF = here .. "/panes.lua"
local INBOX = here .. "/inbox.lua"
local LOCK = (os.getenv("TMPDIR") or "/tmp/"):gsub("/*$", "/") .. "rex-inbox-panes.pid"

local function read_lock()
  local f = io.open(LOCK, "r")
  if not f then return nil end
  local pid = tonumber(f:read("*l") or "")
  f:close()
  return pid
end

local function alive(pid)
  local r = pid and rex.exec{ "kill", "-0", tostring(pid) }
  return r ~= nil and r.ok
end

if rex.args.stop then
  local pid = read_lock()
  if alive(pid) then rex.exec{ "kill", tostring(pid) } end
  os.remove(LOCK)
  return "inbox panes stopped"
end

if not rex.args.watch then
  local pid = read_lock()
  if alive(pid) then return "inbox panes already running (pid " .. pid .. ")" end
  local where = rex.exec{ "sh", "-c", "command -v rex" }
  local rex_bin = where and where.ok and where.stdout:gsub("%s+$", "") or "rex"
  local h, err = rex.exec.start({
    "sh", "-c", 'exec "$1" do "$2" --all watch=true rex="$1" >/dev/null 2>&1 </dev/null',
    "sh", rex_bin, SELF,
  }, { detach = true })
  if not h then error(err, 0) end
  local f = assert(io.open(LOCK, "w"))
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

-- The app window's width in columns. Tabs it has not shown yet keep a
-- default size, so this reads a block a client has sized, in any session,
-- and divides by the share of its window that block fills.
local function window_columns()
  local list = rex.call("session.list")
  for _, s in ipairs(list and list.sessions or {}) do
    local v = rex.call("session.view", { session_id = s.session_id })
    for _, window in ipairs(v and v.windows or {}) do
      local tiled = window.layers and window.layers[1]
      local columns
      each_block(tiled and tiled.layout, function(block_id, rect)
        if columns or not rect or not rect[3] or rect[3] <= 0 then return end
        local size = rex.block.call(TERMINAL, "size", { session_id = s.session_id, block_id = block_id })
        if size and size.columns and type(size.desired) == "table" and #size.desired > 0 then
          columns = size.columns / rect[3]
        end
      end)
      if columns then return columns end
    end
  end
  return nil
end

local function ratio_for()
  local columns = window_columns()
  if not columns then return 0.75 end
  return math.max(MIN_RATIO, math.min(MAX_RATIO, 1 - COLUMNS / columns))
end

local function add_pane(session_id, window)
  local tiled = window.layers and window.layers[1]
  local layout = tiled and tiled.layout
  if not layout or has_inbox(window) then return end
  local anchor = layout.split and layout.split.split_id or layout.block_id
  local first
  each_block(layout, function(block_id) first = first or block_id end)
  if not anchor or not first then return end
  local ratio = ratio_for()
  local made = rex.call("session.new_split", {
    session_id = session_id,
    anchor_id = anchor,
    direction = "horizontal",
    side = "after",
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
        before_block_id = first,
        after_block_id = inbox,
        direction = "horizontal",
        ratio = ratio,
      })
    end
    resize()
    rex.after(0.5, resize)
  end
end

local function view(session_id)
  return rex.call("session.view", { session_id = session_id })
end

local function fill_session(session_id)
  local v = view(session_id)
  for _, window in ipairs(v and v.windows or {}) do add_pane(session_id, window) end
end

local function close_empty_windows(session_id)
  local v = view(session_id)
  for _, window in ipairs(v and v.windows or {}) do
    if only_inbox(window) then
      rex.call("session.close_window", { session_id = session_id, window_id = window.window_id })
    end
  end
end

-- A new window's layout may not be in the view yet when the event arrives.
rex.on("window_created", function(ctx, ev)
  local session_id = ctx.session_id
  rex.after(0.3, function() fill_session(session_id) end)
end)

-- A new session's first window arrives with session_created, not
-- window_created.
rex.on("session_created", function(ctx, ev)
  local session_id = ev.session and ev.session.session_id or ev.session_id or ctx.session_id
  if session_id then
    rex.after(0.3, function() fill_session(session_id) end)
  end
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
