local inputVideo = os.getenv('INPUT_VIDEO')
local projectName = os.getenv('PROJECT_NAME')
local cuts = os.getenv('CLIPS')

local resolve = Resolve()
local projectManager = resolve:GetProjectManager()
local project = projectManager:CreateProject(projectName)
local mediaPool = project:GetMediaPool()
local mediaStorage = resolve:GetMediaStorage()
local clip = mediaStorage:AddItemListToMediaPool(inputVideo)[1]

local function split(pString, pPattern)
  local Table = {} -- NOTE: use {n = 0} in Lua-5.0
  local fpat = "(.-)" .. pPattern
  local last_end = 1
  local s, e, cap = pString:find(fpat, 1)
  while s do
    if s ~= 1 or cap ~= "" then
      table.insert(Table, cap)
    end
    last_end = e + 1
    s, e, cap = pString:find(fpat, last_end)
  end
  if last_end <= #pString then
    cap = pString:sub(last_end)
    table.insert(Table, cap)
  end
  return Table
end

local result = split(cuts, ':::')

local clipInfos = {}

for i, cut in ipairs(result) do
  local splitResult = split(cut, '___')
  clipInfos[i] = {
    startFrame = tonumber(splitResult[1]),
    endFrame = tonumber(splitResult[2]),
    mediaPoolItem = clip
  }
end

mediaPool:CreateEmptyTimeline(projectName)
mediaPool:AppendToTimeline(clipInfos)

resolve:OpenPage("cut")
