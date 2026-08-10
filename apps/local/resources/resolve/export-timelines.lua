-- Add current timeline to render queue
-- Usage: Run this script from the Scripts menu in DaVinci Resolve

-- Get the Resolve instance
resolve = Resolve()

-- Get the project manager
projectManager = resolve:GetProjectManager()
if not projectManager then
    print("Failed to get project manager")
    return
end

-- Get the current project
project = projectManager:GetCurrentProject()
if not project then
    print("No project is currently open")
    return
end

-- Get the current timeline
local timeline = project:GetCurrentTimeline()
if not timeline then
    print("No timeline is currently open")
    return
end

-- Create a folder for exports if it doesn't exist
local exportFolder = "D:\\Exports"

-- Get timeline name
local timelineName = timeline:GetName()
print("Adding timeline to render queue: " .. timelineName)

-- Set render settings for MP4
local renderSettings = {
    ["TargetDir"] = exportFolder,
    ["CustomName"] = timelineName,
    ["ExportVideo"] = true,
    ["ExportAudio"] = true,
    ["FormatWidth"] = 1920,
    ["FormatHeight"] = 1080,
    ["VideoQuality"] = "High",
    ["AudioCodec"] = "aac",
    ["AudioBitDepth"] = 16,
    ["AudioSampleRate"] = 48000,
    ["ColorSpaceTag"] = "Same as Project",
    ["GammaTag"] = "Same as Project",
    ["EncodingProfile"] = "Main",
    ["MultiPassEncode"] = true
}

-- Set the render settings
if not project:SetRenderSettings(renderSettings) then
    print("Failed to set render settings")
    return
end

-- Add render job
local jobId = project:AddRenderJob()
if not jobId then
    print("Failed to add render job")
    return
end

print("Successfully added timeline to render queue")
print("You can start rendering from the Deliver page")

-- Open the Cut page
if not resolve:OpenPage("cut") then
    print("Failed to open Cut page")
    return
end 