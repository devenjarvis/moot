local model = require("model")

local TERMINAL = "com.superlogical.terminal"
local ALL = rex.args.all == true
local REDRAW_DELAY, TICK, SNAPSHOT_TICK, KEY_POLL = 0.1, 1, 30, 0.1
local NOTICE_SECONDS = 8

-- Reads key presses from the pane's tty into a file that the script polls.
-- A rex do script cannot read its own input without blocking its handlers.
-- Each read waits at most 0.1 s, so the reader sees the script exit within
-- that time, then puts the tty back and removes the file. The first sleep
-- lets a reader left by an earlier run in this pane restore the tty before
-- this one saves it.
local KEY_READER = [[
sleep 0.2
saved=$(stty -g <"$1") || exit 1
stty -icanon -echo min 0 time 1 <"$1"
while kill -0 "$3" 2>/dev/null; do dd bs=16 count=1 <"$1" >>"$2" 2>/dev/null; done
stty "$saved" <"$1"
rm -f "$2"
]]

local labels = {}
local blocks = {}
local keys = {}
local notice
local pending

local function block_call(session_id, block_id, method)
  return rex.block.call(TERMINAL, method, { session_id = session_id, block_id = block_id })
end

local function read_folder(session_id, block_id)
  local pwd = block_call(session_id, block_id, "pwd")
  if pwd and type(pwd.pwd) == "string" and pwd.pwd ~= "" then
    return model.folder(pwd.pwd)
  end
  local process = block_call(session_id, block_id, "process")
  return model.folder(process and process.foreground and process.foreground.cwd)
end

local function read_title(session_id, block_id)
  local title = block_call(session_id, block_id, "title")
  return title and title.title or ""
end

local function read_labels()
  local list = rex.call("session.list")
  if not list then return nil end
  local fresh = {}
  for _, s in ipairs(list.sessions or {}) do fresh[s.session_id] = s.label end
  return fresh
end

-- Reads one block's records into `into`. Title and folder are read only for a
-- block that has a matching record, and only when `known` lacks them or
-- `reread` is set. If the read fails, `known` stays as it was.
local function load_block(into, session_id, block_id, known, reread)
  local status = block_call(session_id, block_id, "program_status")
  if not status then
    into[block_id] = known
    return
  end
  local records = status.records
  if type(records) ~= "table" or not model.pick(records, ALL) then
    into[block_id] = nil
    return
  end
  local b = known or { session_id = session_id }
  b.records = records
  if reread or not b.title then b.title = read_title(session_id, block_id) end
  if reread or not b.folder then b.folder = read_folder(session_id, block_id) end
  into[block_id] = b
end

local function snapshot()
  local fresh_labels = read_labels()
  if not fresh_labels then return end
  local fresh = {}
  for session_id in pairs(fresh_labels) do
    local list = rex.call("session.list_blocks", { session_id = session_id })
    if list then
      for _, b in ipairs(list.blocks or {}) do
        if b.creator_name == TERMINAL then
          load_block(fresh, session_id, b.block_id, blocks[b.block_id], true)
        end
      end
    else
      for block_id, b in pairs(blocks) do
        if b.session_id == session_id then fresh[block_id] = b end
      end
    end
  end
  labels, blocks = fresh_labels, fresh
end

local function draw()
  pending = nil
  local size = rex.block_id and block_call(rex.session_id, rex.block_id, "size")
  local width = size and size.columns or 80
  local height = size and size.rows

  local rows = {}
  for block_id, b in pairs(blocks) do
    local record = model.pick(b.records, ALL)
    if record then
      rows[#rows + 1] = {
        block_id = block_id,
        session_id = b.session_id,
        session = labels[b.session_id] or b.session_id,
        folder = b.folder,
        title = b.title,
        record = record,
      }
    end
  end

  local lines, key_lines
  lines, keys, key_lines = model.render(rows, width, os.time(), true)
  local shift = 0
  if notice and os.time() < notice.expires then
    table.insert(lines, 2, "\27[2m" .. model.cut(notice.text, width) .. "\27[0m")
    shift = 1
  else
    notice = nil
  end
  if height and #lines > height then
    for i = #lines, height + 1, -1 do lines[i] = nil end
    for n = #keys, 1, -1 do
      if key_lines[n] + shift > height then keys[n] = nil end
    end
  end

  -- Each line clears its row before writing, rather than after: a line that
  -- fills the last column leaves the cursor there, and erasing from it would
  -- remove the line's last character.
  local out = {}
  for i, line in ipairs(lines) do
    out[#out + 1] = "\27[" .. i .. ";1H\27[2K" .. line
  end
  if not height or #lines < height then
    out[#out + 1] = "\27[" .. (#lines + 1) .. ";1H\27[J"
  end
  io.write(table.concat(out))
  io.flush()
end

local function schedule()
  if not pending then pending = rex.after(REDRAW_DELAY, draw) end
end

local function jump(row)
  local session_id, block_id = row.session_id, row.block_id
  local window_id
  local list = rex.call("session.list_blocks", { session_id = session_id })
  for _, b in ipairs(list and list.blocks or {}) do
    if b.block_id == block_id then window_id = b.window_id end
  end
  rex.call("session.focus_block", { session_id = session_id, block_id = block_id })
  local ok, result, err = pcall(rex.client.queue, "session.select", { session_id = session_id, window_id = window_id })
  if not ok then err = result end
  if not ok or (result == nil and err ~= nil) then
    err = tostring(err)
    if err:find("Remote Control", 1, true) then
      err = "Turn on Remote Control in Rex Settings to jump"
    end
    notice = { text = err, expires = os.time() + NOTICE_SECONDS }
  end
  schedule()
end

local function start_key_reader()
  if not rex.block_id then return nil end
  local process = block_call(rex.session_id, rex.block_id, "process")
  local pid = process and process.foreground and process.foreground.pid
  if not pid then return nil end
  local ps = rex.exec{ "ps", "-o", "tty=", "-p", tostring(pid) }
  local tty = ps and ps.ok and ps.stdout:gsub("%s+", "")
  if not tty or tty == "" or tty:find("?", 1, true) then return nil end

  local made = rex.exec{ "mktemp", "-t", "rex-inbox-keys" }
  local path = made and made.ok and made.stdout:gsub("%s+$", "")
  if not path or path == "" then return nil end
  local h = rex.exec.start({ "sh", "-c", KEY_READER, "sh", "/dev/" .. tty, path, tostring(pid) }, { detach = true })
  if not h then
    os.remove(path)
    return nil
  end
  return io.open(path, "rb")
end

local function read_keys(file)
  local data = file:read("*a")
  if not data or data == "" then return end
  data = data:gsub("\27%[[%d;?]*[%a~]", ""):gsub("\27O%a", "")
  for digit in data:gmatch("%d") do
    local row = keys[tonumber(digit)]
    if row then jump(row) end
  end
end

local function refresh_block(ctx)
  local session_id, block_id = ctx.session_id, ctx.block_id
  if not session_id or not block_id then return end
  if not labels[session_id] then labels = read_labels() or labels end
  load_block(blocks, session_id, block_id, blocks[block_id])
  schedule()
end

rex.on("terminal.program_status_changed", refresh_block)
rex.on("terminal.program_status_removed", refresh_block)

rex.on("terminal.title_changed", function(ctx, ev)
  local b = blocks[ctx.block_id]
  if b then
    b.title = ev.title or ""
    schedule()
  end
end)

rex.on("terminal.pwd_changed", function(ctx, ev)
  local b = blocks[ctx.block_id]
  if b then
    b.folder = model.folder(ev.pwd)
    schedule()
  end
end)

rex.on("block_closed", function(ctx, ev)
  if blocks[ev.block_id] then
    blocks[ev.block_id] = nil
    schedule()
  end
end)

rex.on("session_destroyed", function(ctx, ev)
  local session_id = ev.session_id or ctx.session_id
  for block_id, b in pairs(blocks) do
    if b.session_id == session_id then blocks[block_id] = nil end
  end
  labels[session_id] = nil
  schedule()
end)

rex.on("session_label_changed", function(ctx, ev)
  labels[ev.session_id or ctx.session_id] = ev.label
  schedule()
end)

-- Under --all, calls into other sessions fail until the script's top level
-- returns, so the first snapshot runs from a timer.
rex.after(0, function()
  snapshot()
  draw()
end)
rex.every(SNAPSHOT_TICK, function()
  snapshot()
  schedule()
end)
-- Rex sends no event when a pane is resized, so a short tick redraws at the
-- new width as well as moving the ages on.
rex.every(TICK, schedule)

local key_file = start_key_reader()
if key_file then
  rex.every(KEY_POLL, function() read_keys(key_file) end)
end
