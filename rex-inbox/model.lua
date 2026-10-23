local M = {}

M.STATES = { "blocked", "error", "done", "working", "idle" }

local RANK = {}
for i, state in ipairs(M.STATES) do RANK[state] = i end

local SYMBOL = { blocked = "▲", error = "✗", done = "✓", working = "◷", idle = "○" }
local COLOR = { blocked = "1;31", error = "31", done = "32", working = "33", idle = "2" }

local APP = "claude-code"
local MAX_SESSION, MAX_FOLDER = 20, 24

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

local function cp_width(cp)
  if is_control(cp) then return 0 end
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

local function pad(s, width)
  s = cut(s, width)
  return s .. string.rep(" ", width - M.width(s))
end

local function column_width(rows, key, max)
  local w = 0
  for _, r in ipairs(rows) do w = math.max(w, M.width(r[key])) end
  return math.min(w, max)
end

function M.render(rows, width, now, color)
  local sorted = {}
  for i, r in ipairs(rows) do
    sorted[i] = {
      record = r.record,
      block_id = r.block_id,
      session = clean(r.session),
      folder = clean(r.folder),
      title = clean(r.title),
      age = M.age(r.record.updated_at, now),
    }
  end
  M.sort(sorted)

  local lines = { cut(M.counts(sorted), width) }
  local aw = column_width(sorted, "age", 4)
  local sw = column_width(sorted, "session", MAX_SESSION)
  local fw = column_width(sorted, "folder", MAX_FOLDER)
  for _, r in ipairs(sorted) do
    local rec = r.record
    local text = {}
    if r.title ~= "" then text[#text + 1] = r.title end
    local msg = clean(rec.msg)
    if rec.state == "blocked" and rec.kind then msg = "[" .. clean(rec.kind) .. "] " .. msg end
    if msg ~= "" then text[#text + 1] = msg end
    local symbol = SYMBOL[rec.state]
    local line = cut(table.concat({
      symbol, pad(r.age, aw), pad(r.session, sw), pad(r.folder, fw), table.concat(text, "  "),
    }, "  "):gsub("%s+$", ""), width)
    if color and line:sub(1, #symbol) == symbol then
      line = "\27[" .. COLOR[rec.state] .. "m" .. symbol .. "\27[0m" .. line:sub(#symbol + 1)
    end
    lines[#lines + 1] = line
  end
  return lines
end

return M
