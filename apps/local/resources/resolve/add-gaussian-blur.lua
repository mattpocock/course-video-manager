local resolve = Resolve()
local projectManager = resolve:GetProjectManager()
local project = projectManager:GetCurrentProject()

local timeline = project:GetCurrentTimeline()


local item = timeline:GetCurrentVideoItem()

local properties = item:GetProperty()

-- Print each property

for k, v in pairs(properties) do
  print(k .. ": ", v)
end
