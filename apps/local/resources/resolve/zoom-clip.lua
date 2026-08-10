-- Get the Resolve application instance
local resolve = Resolve()
-- Get the project manager to access current project
local projectManager = resolve:GetProjectManager()
-- Get the currently open project
local project = projectManager:GetCurrentProject()

-- Get the current timeline from the project
local timeline = project:GetCurrentTimeline()

-- Get the current clip
local currentClip = timeline:GetCurrentVideoItem()

if not currentClip then
    error("No clip selected")
end

-- Set the zoom and position values to match the screenshot
currentClip:SetClipProperty("Scale", 1.19)
currentClip:SetClipProperty("PositionX", 41)
currentClip:SetClipProperty("PositionY", -52)

print("Successfully set zoom and position on selected clip") 