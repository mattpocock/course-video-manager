local input = os.getenv('INPUT')
local resolve = Resolve()
local projectManager = resolve:GetProjectManager()
local project = projectManager:GetCurrentProject()

if not project then
    print('No project open')
    os.exit()
end

local mediaStorage = resolve:GetMediaStorage()

local clips = mediaStorage:AddItemListToMediaPool(input)

for i, clip in ipairs(clips) do
  print(clip:GetMediaId())
end
