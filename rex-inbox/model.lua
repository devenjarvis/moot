local M = {}

M.STATES = { "blocked", "error", "done", "working", "idle" }

local RANK = {}
for i, state in ipairs(M.STATES) do RANK[state] = i end

local SYMBOL = { blocked = "▲", error = "✗", done = "✓", working = "◷", idle = "○" }
local COLOR = { blocked = "1;31", error = "31", done = "32", working = "33", idle = "2" }

local APP = "claude-code"
local MAX_KEYS = 9

local function days_from_civil(y, m, d)
  if m <= 2 then y = y - 1 end
  local era = math.floor(y / 400)
  local yoe = y - era * 400
  local mp = m > 2 and m - 3 or m + 9
  local doy = math.floor((153 * mp + 2) / 5) + d - 1
  local doe = yoe * 365 + math.floor(yoe / 4) - math.floor(yoe / 100) + doy
  return era * 146097 + doe - 719468
end

function M.parse_time(s)
  if type(s) ~= "string" then return nil end
  local y, mo, d, h, mi, sec, frac, zone =
    s:match("^(%d%d%d%d)%-(%d%d)%-(%d%d)T(%d%d):(%d%d):(%d%d)(%.?%d*)(.*)$")
  if not y then return nil end
  local offset
  if zone == "Z" or zone == "z" then
    offset = 0
  else
    local sign, oh, om = zone:match("^([+-])(%d%d):?(%d%d)$")
    if not sign then return nil end
    offset = (tonumber(oh) * 3600 + tonumber(om) * 60) * (sign == "-" and -1 or 1)
  end
  local t = days_from_civil(tonumber(y), tonumber(mo), tonumber(d)) * 86400
    + tonumber(h) * 3600 + tonumber(mi) * 60 + tonumber(sec) - offset
  if frac ~= "" and frac ~= "." then t = t + tonumber("0" .. frac) end
  return t
end

function M.age(updated_at, now)
  local t = M.parse_time(updated_at)
  if not t then return "" end
  local s = math.max(0, math.floor(now - t))
  if s < 60 then return s .. "s" end
  if s < 3600 then return math.floor(s / 60) .. "m" end
  if s < 86400 then return math.floor(s / 3600) .. "h" end
  return math.floor(s / 86400) .. "d"
end

function M.folder(pwd)
  if type(pwd) ~= "string" or pwd == "" then return "" end
  local path = pwd:match("^file://[^/]*(/.*)$") or pwd
  path = path:gsub("%%(%x%x)", function(hex) return string.char(tonumber(hex, 16)) end)
  path = path:gsub("/+$", "")
  if path == "" then return "/" end
  return path:match("([^/]+)$") or path
end

local function urgent_first(a, b)
  local ra, rb = RANK[a.state], RANK[b.state]
  if ra ~= rb then return ra < rb end
  local ta, tb = M.parse_time(a.updated_at) or 0, M.parse_time(b.updated_at) or 0
  if ta == tb then return nil end
  if ra <= RANK.done then return ta < tb end
  return ta > tb
end

function M.pick(records, all)
  local best
  for _, r in ipairs(records or {}) do
    local app = r.effective_app or r.app
    if RANK[r.state] and (all or app == APP) then
      if not best or urgent_first(r, best) then best = r end
    end
  end
  return best
end

function M.sort(rows)
  table.sort(rows, function(a, b)
    local first = urgent_first(a.record, b.record)
    if first ~= nil then return first end
    local ka = (a.session or "") .. "\0" .. (a.title or "") .. "\0" .. (a.block_id or "")
    local kb = (b.session or "") .. "\0" .. (b.title or "") .. "\0" .. (b.block_id or "")
    return ka < kb
  end)
  return rows
end

function M.counts(rows)
  local n = {}
  for _, r in ipairs(rows) do n[r.record.state] = (n[r.record.state] or 0) + 1 end
  local parts = {}
  for _, state in ipairs(M.STATES) do
    if n[state] then parts[#parts + 1] = n[state] .. " " .. state end
  end
  if #parts == 0 then return "no agents" end
  return table.concat(parts, " · ")
end

-- Yields each UTF-8 character and its code point. A byte that does not start
-- a valid sequence comes back as "?" so the output stays valid UTF-8.
local function chars(s)
  local i, n = 1, #s
  return function()
    if i > n then return nil end
    local c = s:byte(i)
    local len, cp
    if c < 0x80 then len, cp = 1, c
    elseif c >= 0xC2 and c < 0xE0 then len, cp = 2, c - 0xC0
    elseif c >= 0xE0 and c < 0xF0 then len, cp = 3, c - 0xE0
    elseif c >= 0xF0 and c < 0xF5 then len, cp = 4, c - 0xF0
    else len = 0 end
    for j = 1, len - 1 do
      local cc = s:byte(i + j)
      if not cc or cc < 0x80 or cc > 0xBF then len = 0 break end
      cp = cp * 64 + (cc - 0x80)
    end
    if len == 0 then
      i = i + 1
      return "?", 0x3F
    end
    local ch = s:sub(i, i + len - 1)
    i = i + len
    return ch, cp
  end
end

local function is_control(cp)
  return cp < 0x20 or (cp >= 0x7F and cp <= 0x9F)
    or (cp >= 0x200B and cp <= 0x200F) or (cp >= 0x202A and cp <= 0x202E)
    or (cp >= 0x2066 and cp <= 0x2069)
end

-- Emoji below U+1F300 that terminals draw two columns wide.
local WIDE_EMOJI = {}
for _, cp in ipairs({
  0x231A, 0x231B, 0x23E9, 0x23EA, 0x23EB, 0x23EC, 0x23F0, 0x23F3, 0x25FD, 0x25FE,
  0x2614, 0x2615, 0x2648, 0x2649, 0x264A, 0x264B, 0x264C, 0x264D, 0x264E, 0x264F,
  0x2650, 0x2651, 0x2652, 0x2653, 0x267F, 0x2693, 0x26A1, 0x26AA, 0x26AB, 0x26BD,
  0x26BE, 0x26C4, 0x26C5, 0x26CE, 0x26D4, 0x26EA, 0x26F2, 0x26F3, 0x26F5, 0x26FA,
  0x26FD, 0x2705, 0x270A, 0x270B, 0x2728, 0x274C, 0x274E, 0x2753, 0x2754, 0x2755,
  0x2757, 0x2795, 0x2796, 0x2797, 0x27B0, 0x27BF, 0x2B1B, 0x2B1C, 0x2B50, 0x2B55,
  0x1F004, 0x1F0CF, 0x1F18E,
}) do WIDE_EMOJI[cp] = true end

local function cp_width(cp)
  if is_control(cp) then return 0 end
  if WIDE_EMOJI[cp] or (cp >= 0x1F191 and cp <= 0x1F19A) or (cp >= 0x1F200 and cp <= 0x1F2FF) then
    return 2
  end
  if (cp >= 0x1100 and cp <= 0x115F) or (cp >= 0x2E80 and cp <= 0xA4CF)
    or (cp >= 0xAC00 and cp <= 0xD7A3) or (cp >= 0xF900 and cp <= 0xFAFF)
    or (cp >= 0xFE30 and cp <= 0xFE4F) or (cp >= 0xFF00 and cp <= 0xFF60)
    or (cp >= 0xFFE0 and cp <= 0xFFE6) or (cp >= 0x1F300 and cp <= 0x1FAFF)
    or (cp >= 0x20000 and cp <= 0x3FFFD) then
    return 2
  end
  return 1
end

function M.width(s)
  local w = 0
  for _, cp in chars(s) do w = w + cp_width(cp) end
  return w
end

local function clean(s)
  if type(s) ~= "string" then return "" end
  local out = {}
  for ch, cp in chars(s) do
    if not is_control(cp) then out[#out + 1] = ch end
  end
  return table.concat(out)
end

local function cut(s, width)
  if M.width(s) <= width then return s end
  if width <= 0 then return "" end
  local out, w = {}, 0
  for ch, cp in chars(s) do
    local cw = cp_width(cp)
    if w + cw > width - 1 then break end
    out[#out + 1] = ch
    w = w + cw
  end
  return table.concat(out) .. "…"
end
M.cut = cut

-- Wraps the symbol that starts at byte `at` in its state's color, if cutting
-- the line left it whole.
local function paint(line, at, symbol, state)
  if line:sub(at, at + #symbol - 1) ~= symbol then return line end
  return line:sub(1, at - 1) .. "\27[" .. COLOR[state] .. "m" .. symbol .. "\27[0m"
    .. line:sub(at + #symbol)
end

function M.group(rows)
  local by_key, groups = {}, {}
  for _, r in ipairs(rows) do
    local key = r.session_id or r.session
    local g = by_key[key]
    if not g then
      g = { session = r.session, rows = {} }
      by_key[key] = g
      groups[#groups + 1] = g
    end
    g.rows[#g.rows + 1] = r
  end
  for _, g in ipairs(groups) do
    M.sort(g.rows)
    g.top = g.rows[1]
    g.folder = g.top.folder
    for _, r in ipairs(g.rows) do
      if r.folder ~= g.folder then
        g.folder = nil
        break
      end
    end
  end
  table.sort(groups, function(a, b)
    local first = urgent_first(a.top.record, b.top.record)
    if first ~= nil then return first end
    return (a.session or "") < (b.session or "")
  end)
  return groups
end

local function agent_lines(r, key, folder_known, width, now)
  local rec = r.record
  local symbol = SYMBOL[rec.state]
  local prefix = "  " .. key .. " " .. symbol .. " "
  local indent = M.width(prefix)

  local msg = clean(rec.msg)
  if rec.state == "blocked" and rec.kind then
    msg = ("[" .. clean(rec.kind) .. "] " .. msg):gsub("%s+$", "")
  end
  local title = r.title
  if not folder_known and r.folder ~= "" then
    title = title ~= "" and (r.folder .. " · " .. title) or r.folder
  end
  if title == "" then title, msg = msg, "" end

  local age = M.age(rec.updated_at, now)
  local room = width - indent - M.width(age) - 1
  local line
  if room >= 1 then
    local t = cut(title, room)
    line = prefix .. t .. string.rep(" ", room - M.width(t) + 1) .. age
  else
    line = cut(prefix .. title, width)
  end
  local out = { { text = line:gsub("%s+$", ""), symbol = symbol, at = #prefix - #symbol, state = rec.state } }
  if msg ~= "" then out[2] = { text = cut(string.rep(" ", indent) .. msg, width) } end
  return out
end

-- Returns the lines to draw, the row each key from 1 to MAX_KEYS stands for,
-- and the line each key's agent starts on.
function M.render(rows, width, now, color)
  local cleaned = {}
  for i, r in ipairs(rows) do
    cleaned[i] = {
      source = r,
      record = r.record,
      block_id = r.block_id,
      session_id = r.session_id,
      session = clean(r.session),
      folder = clean(r.folder),
      title = clean(r.title),
    }
  end

  local lines, keys, key_lines = { cut(M.counts(cleaned), width) }, {}, {}
  local function add(text, at, symbol, state)
    if color and symbol then text = paint(text, at, symbol, state) end
    lines[#lines + 1] = text
  end

  for i, g in ipairs(M.group(cleaned)) do
    if i > 1 then add("") end
    local state = g.top.record.state
    local head = SYMBOL[state] .. " " .. g.session
    if g.folder and g.folder ~= "" then head = head .. " · " .. g.folder end
    add(cut(head, width), 1, SYMBOL[state], state)
    for _, r in ipairs(g.rows) do
      local key = " "
      if #keys < MAX_KEYS then
        keys[#keys + 1] = r.source
        key_lines[#keys] = #lines + 1
        key = tostring(#keys)
      end
      for _, l in ipairs(agent_lines(r, key, g.folder ~= nil, width, now)) do
        add(l.text, l.at, l.symbol, l.state)
      end
    end
  end
  return lines, keys, key_lines
end

return M
