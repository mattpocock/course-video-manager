-- Get the Resolve instance
resolve = Resolve()

-- Get the current project
projectManager = resolve:GetProjectManager()
project = projectManager:GetCurrentProject()

if not project then
    print("No project is currently loaded")
    return
end

-- Get the media pool
mediaPool = project:GetMediaPool()

if not mediaPool then
    print("Could not get media pool")
    return
end

-- Create a unique timeline name with timestamp
local baseName = "New Timeline"
local timestamp = os.date("%Y%m%d_%H%M%S")
local timelineName = baseName .. " " .. timestamp

-- Create the timeline
timeline = mediaPool:CreateEmptyTimeline(timelineName)

if timeline then
    print("Successfully created timeline: " .. timelineName)
    -- Open the Cut page
    resolve:OpenPage("cut")
else
    print("Failed to create timeline")
end
