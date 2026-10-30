/**
 * A tee behind fifos, as every relay and feed the recorder sends is
 * (`capture-args.ts`, `stream-feeds.ts`): each slave gets its own queue,
 * dropped when full, its connection retried every 0.5 s for ever.
 */
export const teeWith = (queueSize: number, slaves: string) => [
  "-f",
  "tee",
  "-use_fifo",
  "1",
  "-fifo_options",
  `attempt_recovery=1:recover_any_error=1:recovery_wait_time=0.5:max_recovery_attempts=0:drop_pkts_on_overflow=1:queue_size=${queueSize}`,
  slaves,
];

/**
 * The relays' raw picture. One thread: ffmpeg's rawvideo encoder is
 * frame-threaded, and its threads hold each frame until the next one comes,
 * a whole frame (33 ms) late on every relay (#2207, measured).
 */
export const RAW_RELAY = ["-c:v", "rawvideo", "-threads:v", "1"];
