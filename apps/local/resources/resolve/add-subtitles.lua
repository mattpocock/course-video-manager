-- Get the Resolve application instance
local resolve = Resolve()
-- Get the project manager to access current project
local projectManager = resolve:GetProjectManager()
-- Get the currently open project
local project = projectManager:GetCurrentProject()

-- Get the current timeline from the project
local timeline = project:GetCurrentTimeline()

-- Check if subtitles already exist
local subtitleTrackCount = timeline:GetTrackCount("subtitle")
if subtitleTrackCount > 0 then
  print("Subtitles already exist in the timeline. Skipping generation.")
else
  -- Create a table to store subtitle generation options
  local subtitleOptions = {}

  -- Set the language for auto-generated subtitles to English
  subtitleOptions[resolve.SUBTITLE_LANGUAGE] = resolve.AUTO_CAPTION_ENGLISH
  -- Set the maximum number of characters per line in the subtitles
  subtitleOptions[resolve.SUBTITLE_CHARS_PER_LINE] = 33

  -- Generate subtitles from the audio in the current timeline using the specified options
  timeline:CreateSubtitlesFromAudio(subtitleOptions)
end

-- Get the output folder from environment variable
local outputFolder = os.getenv('OUTPUT_FOLDER')

if not outputFolder then
  error('No OUTPUT_FOLDER provided')
end

-- Get timeline name and create output path
local timelineName = timeline:GetName()
local outputPath = outputFolder .. "\\" .. timelineName .. ".srt"

-- Export the subtitles as SRT file
timeline:Export(outputPath, resolve.EXPORT_SRT)