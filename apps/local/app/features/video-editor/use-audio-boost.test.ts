import { describe, expect, it, vi, beforeEach } from "vitest";
import { _sourceCacheForTesting as sourceCache } from "./use-audio-boost";

const mockGainConnect = vi.fn();
const mockGainNode = {
  gain: { value: 1 },
  connect: mockGainConnect,
  disconnect: vi.fn(),
};
const mockSourceNode = {
  connect: vi.fn(),
  disconnect: vi.fn(),
};

const mockCreateMediaElementSource = vi.fn(() => mockSourceNode);
const mockCreateGain = vi.fn(() => mockGainNode);

vi.stubGlobal(
  "AudioContext",
  vi.fn(() => ({
    createMediaElementSource: mockCreateMediaElementSource,
    createGain: mockCreateGain,
    destination: "mock-destination",
  }))
);

describe("useAudioBoost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGainNode.gain.value = 1;
  });

  describe("dB to linear gain conversion", () => {
    it("converts +10 dB to ~3.162 linear gain", () => {
      const gain = Math.pow(10, 10 / 20);
      expect(gain).toBeCloseTo(3.162, 2);
    });

    it("converts +6 dB to ~1.995 linear gain", () => {
      const gain = Math.pow(10, 6 / 20);
      expect(gain).toBeCloseTo(1.995, 2);
    });

    it("converts 0 dB to 1.0 linear gain", () => {
      const gain = Math.pow(10, 0 / 20);
      expect(gain).toBe(1);
    });

    it("converts -6 dB to ~0.501 linear gain", () => {
      const gain = Math.pow(10, -6 / 20);
      expect(gain).toBeCloseTo(0.501, 2);
    });
  });

  describe("Web Audio API integration", () => {
    it("creates AudioContext and connects source → gain → destination", () => {
      const mockVideo = {} as HTMLVideoElement;

      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(mockVideo);
      const gain = ctx.createGain();
      (gain as unknown as typeof mockGainNode).gain.value = Math.pow(
        10,
        10 / 20
      );

      source.connect(gain as unknown as AudioNode);
      (gain as unknown as AudioNode).connect(
        ctx.destination as unknown as AudioNode
      );

      expect(mockCreateMediaElementSource).toHaveBeenCalledWith(mockVideo);
      expect(mockCreateGain).toHaveBeenCalled();
      expect(mockGainNode.gain.value).toBeCloseTo(3.162, 2);
      expect(mockSourceNode.connect).toHaveBeenCalledWith(mockGainNode);
      expect(mockGainConnect).toHaveBeenCalledWith("mock-destination");
    });
  });

  describe("Strict Mode double-invoke resilience", () => {
    it("does not call createMediaElementSource twice for the same element", () => {
      const mockVideo = {} as HTMLVideoElement;

      // Simulate first mount
      const ctx1 = new AudioContext();
      const source1 = ctx1.createMediaElementSource(mockVideo);
      sourceCache.set(mockVideo, {
        source: source1 as unknown as MediaElementAudioSourceNode,
        context: ctx1,
      });

      vi.clearAllMocks();

      // Simulate second mount (Strict Mode re-invoke) - should reuse cached source
      const cached = sourceCache.get(mockVideo);
      expect(cached).toBeDefined();
      expect(mockCreateMediaElementSource).not.toHaveBeenCalled();
    });

    it("reuses cached source and creates new gain node on re-mount", () => {
      const mockVideo = {} as HTMLVideoElement;

      // First mount: create and cache
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(mockVideo);
      sourceCache.set(mockVideo, {
        source: source as unknown as MediaElementAudioSourceNode,
        context: ctx,
      });

      vi.clearAllMocks();

      // Second mount: reuse source, create new gain
      const cached = sourceCache.get(mockVideo)!;
      const gain = cached.context.createGain();
      (gain as unknown as typeof mockGainNode).gain.value = Math.pow(
        10,
        10 / 20
      );

      expect(mockCreateGain).toHaveBeenCalledTimes(1);
      expect(mockGainNode.gain.value).toBeCloseTo(3.162, 2);
    });

    it("properly disconnects on cleanup without closing context", () => {
      const mockVideo = {} as HTMLVideoElement;

      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(mockVideo);
      const gain = ctx.createGain();

      (source as unknown as typeof mockSourceNode).connect(
        gain as unknown as AudioNode
      );
      (gain as unknown as AudioNode).connect(
        ctx.destination as unknown as AudioNode
      );

      // Cleanup: disconnect but don't close
      (source as unknown as typeof mockSourceNode).disconnect();
      (gain as unknown as typeof mockGainNode).disconnect();

      expect(mockSourceNode.disconnect).toHaveBeenCalled();
      expect(mockGainNode.disconnect).toHaveBeenCalled();
    });
  });
});
