local resolve = Resolve()
local projectManager = resolve:GetProjectManager()
local project = projectManager:GetCurrentProject()

local mediaPool = project:GetMediaPool()

local folder = mediaPool:GetCurrentFolder()

local clips = folder:GetClipList()

for i, clip in ipairs(clips) do
  print(clip:GetMediaId() .. ":::" .. clip:GetClipProperty("File Path"))
end
