--[[
Multi-Track Clip and Append Script for DaVinci Resolve
-----------------------------------------------------
This script is designed to work with DaVinci Resolve to append clips
from multiple videos to a timeline, with each clip on a specified track.

Environment Variables Required:
- INPUT_VIDEOS: String containing paths to video files separated by ":::"
- CLIPS_TO_APPEND: String containing clip information in the format
  "startFrame___endFrame___videoIndex___trackIndex___[timelineStartFrame]:::..."
  where:
    - startFrame: starting frame in the source video
    - endFrame: ending frame in the source video
    - videoIndex: index of the video in INPUT_VIDEOS (0-based)
    - trackIndex: which track to place the clip on (1-based)
    - timelineStartFrame: (optional) position in timeline to place clip
- NEW_TIMELINE_NAME: String containing the desired name for the timeline. The timeline will be created with this name.

Functionality:
1. Takes multiple video files and specified clip information
2. Adds all videos to the media pool
3. Creates clips based on the specified parameters
4. Places clips at specific timeline positions on their specified tracks
5. Opens the Cut page in Resolve

Example Usage:
INPUT_VIDEOS="/path/to/video1.mp4:::/path/to/video2.mp4"
CLIPS_TO_APPEND="0___100___0___1___500:::200___300___1___1:::50___150___0___2"
# First clip: from video 0, placed at timeline frame 500 on track 1
# Second clip: from video 1, appended to end of track 1
# Third clip: from video 0, appended to end of track 2
]]

local resolve = Resolve()
local projectManager = resolve:GetProjectManager()
local project = projectManager:GetCurrentProject()

local mediaPool = project:GetMediaPool()
local folder = mediaPool:GetCurrentFolder()

local inputVideos = os.getenv('INPUT_VIDEOS')

if not inputVideos then
  error('No INPUT_VIDEOS provided')
end

local clipsToAppend = os.getenv('CLIPS_TO_APPEND')

if not clipsToAppend then
  error('No CLIPS_TO_APPEND provided')
end

local mediaStorage = resolve:GetMediaStorage()

-- Split function for parsing strings
local function split(pString, pPattern)
  local Table = {}
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

-- Parse input videos
local videoPaths = split(inputVideos, ';')

-- Add all videos to media pool and create a mapping of video index to media pool item
local videoIndexToClip = {}

for videoIndex, videoPath in ipairs(videoPaths) do
  -- Add video to media pool
  local clips = mediaStorage:AddItemListToMediaPool(videoPath)
  local mediaId = clips[1]:GetMediaId()

  -- Refresh folder clips after adding video
  local folderClips = folder:GetClipList()

  -- Find the clip in the folder
  local clip
  for i, folderClip in ipairs(folderClips) do
    if folderClip:GetMediaId() == mediaId then
      clip = folderClip
      break
    end
  end

  -- Store the clip with its index (0-based for the API)
  videoIndexToClip[videoIndex - 1] = clip
end

-- Always create a new timeline
local newTimelineName = os.getenv('NEW_TIMELINE_NAME')

if not newTimelineName then
  error('No NEW_TIMELINE_NAME provided')
end

print("Creating a new timeline...")
local timeline = mediaPool:CreateEmptyTimeline(newTimelineName)
if not timeline then
  error("Failed to create new timeline")
end
print("Created new timeline: " .. timeline:GetName())

local globalTimelineStartFrame = timeline:GetStartFrame()

-- Parse clips to append
local clipData = split(clipsToAppend, ':::')

-- Process clips in the order they appear in CLIPS_TO_APPEND
for i, clipInfo in ipairs(clipData) do
  local parts = split(clipInfo, '___')
  local startFrame = tonumber(parts[1])
  local endFrame = tonumber(parts[2])
  local videoIndex = tonumber(parts[3])
  local trackIndex = tonumber(parts[4])
  local timelineStartFrame = parts[5] and tonumber(parts[5]) or nil

  local clip = videoIndexToClip[videoIndex]
  if not clip then
    error('Video index ' .. videoIndex .. ' not found in input videos')
  end

  if not trackIndex or trackIndex < 1 then
    error('Invalid track index: ' .. tostring(trackIndex))
  end

  -- Ensure we have enough video tracks for this clip
  local currentVideoTracks = timeline:GetTrackCount("video")
  while currentVideoTracks < trackIndex do
    timeline:AddTrack("video")
    currentVideoTracks = currentVideoTracks + 1
  end

  -- Create clip info for this clip
  local clipInfo = {
    startFrame = startFrame,
    endFrame = endFrame,
    mediaPoolItem = clip,
    trackIndex = trackIndex
  }

  -- Only add recordFrame if timelineStartFrame is provided
  if timelineStartFrame then
    clipInfo.recordFrame = timelineStartFrame + globalTimelineStartFrame
  end

  -- Append this clip to the timeline immediately
  local clipInfos = {clipInfo}
  local appendedItems = mediaPool:AppendToTimeline(clipInfos)
end

-- Add a marker to the timeline
local globalTimelineEndFrame = timeline:GetEndFrame()
timeline:AddMarker((globalTimelineEndFrame - globalTimelineStartFrame), "Blue", "Multi-Track Append Point", "Content appended after this point", 1)

resolve:OpenPage("cut")

