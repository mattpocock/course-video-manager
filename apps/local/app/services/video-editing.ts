// Extract audio buffer from video URL
export async function extractAudioFromVideoURL(
  videoUrl: string
): Promise<AudioBuffer> {
  const audioContext = new AudioContext();

  try {
    // Fetch the video file from URL
    const response = await fetch(videoUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch video: ${response.status} ${response.statusText}`
      );
    }

    // Get the array buffer from the response
    const arrayBuffer = await response.arrayBuffer();

    // Decode the audio data
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    return audioBuffer;
  } catch (error) {
    console.error("Error extracting audio from video URL:", error);
    throw new Error(
      `Failed to extract audio from video URL: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

// Generate waveform data from audio buffer
export function generateWaveformData(
  audioBuffer: AudioBuffer,
  samplesPerFrame: number
): number[] {
  const channelData = audioBuffer.getChannelData(0); // Use first channel
  const waveformData: number[] = [];

  // Process audio in chunks
  for (let i = 0; i < channelData.length; i += samplesPerFrame) {
    let max = 0;
    let rms = 0;
    const chunkSize = Math.min(samplesPerFrame, channelData.length - i);

    // Find peak and RMS values in this chunk
    for (let j = 0; j < chunkSize; j++) {
      const sample = Math.abs(channelData[i + j]!);
      max = Math.max(max, sample);
      rms += sample * sample;
    }

    rms = Math.sqrt(rms / chunkSize);

    // Use RMS for smoother waveform, or max for more detailed peaks
    waveformData.push(rms);
  }

  return waveformData;
}

// Get waveform data for specific time range
export function getWaveformForTimeRange(
  audioBuffer: AudioBuffer,
  startTime: number,
  endTime: number,
  resolution: number = 100
): number[] {
  const sampleRate = audioBuffer.sampleRate;
  const channelData = audioBuffer.getChannelData(0);

  const startSample = Math.floor(startTime * sampleRate);
  const endSample = Math.floor(endTime * sampleRate);
  const rangeSamples = endSample - startSample;
  const samplesPerPoint = Math.floor(rangeSamples / resolution);

  const waveformData: number[] = [];

  for (let i = 0; i < resolution; i++) {
    const sampleStart = startSample + i * samplesPerPoint;
    const sampleEnd = Math.min(sampleStart + samplesPerPoint, endSample);

    let max = 0;
    for (let j = sampleStart; j < sampleEnd; j++) {
      max = Math.max(max, Math.abs(channelData[j] || 0));
    }

    waveformData.push(max);
  }

  return waveformData;
}

// Usage example for video editor timeline
export async function processVideoForEditor(videoUrl: string): Promise<{
  duration: number;
  sampleRate: number;
  waveformData: number[];
}> {
  try {
    const audioBuffer = await extractAudioFromVideoURL(videoUrl);

    const waveformData = generateWaveformData(audioBuffer, 2048);

    return {
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
      waveformData,
    };
  } catch (error) {
    console.error("Failed to process audio:", error);
    throw error;
  }
}

// Get waveform data for current video frame/time
export function getWaveformAtTime(
  audioBuffer: AudioBuffer,
  currentTime: number,
  windowSize: number = 0.1 // 100ms window
): number {
  const startTime = Math.max(0, currentTime - windowSize / 2);
  const endTime = Math.min(audioBuffer.duration, currentTime + windowSize / 2);

  const waveformChunk = getWaveformForTimeRange(
    audioBuffer,
    startTime,
    endTime,
    1
  );
  return waveformChunk[0] || 0;
}
