local resolve = Resolve()
local projectManager = resolve:GetProjectManager()
local project = projectManager:GetCurrentProject()

local timeline = project:GetCurrentTimeline()

local currentItem = timeline:GetCurrentVideoItem()

local mediaPoolItem = currentItem:GetMediaPoolItem()

local filePath = mediaPoolItem:GetClipProperty("File Path")

print(mediaPoolItem:GetMediaId() .. ":::" .. filePath .. ":::" .. currentItem:GetLeftOffset() .. ":::" .. currentItem:GetDuration())