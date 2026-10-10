# Synthetic camera / screen / mic for the selftest. Runs on Windows, never opens a device.
#
# Why not ffmpeg's own testsrc + realtime filter? ffmpeg.exe paces with Sleep(),
# which ticks at 15.6 ms on Windows, so its frames arrive in bursts, and a real
# camera or mic delivers on a device event instead. WSL-side generators are no
# better here: the WSL clock on this machine ran ~4% slow against Windows.
# This source raises its own timer resolution, paces on the QPC (Stopwatch)
# with a short spin, and writes raw frames/samples to TCP the moment they are due.
#
# Each source has its own clock (-Speed 1.0003 = a crystal 300 ppm fast). The
# flash and beep are tied to the Windows WALL clock (every -Period seconds,
# 250 ms long), the way a real camera and mic see a real flash and beep. A video
# frame's brightness is the fraction of its exposure (the frame interval before
# it is sent) that overlaps the flash, so the onset carries sub-frame timing.
param(
  [ValidateSet("video", "audio")][string]$Kind,
  [int]$Port,
  [int]$Width = 320,
  [int]$Height = 180,
  [double]$Fps = 60,
  [double]$Speed = 1.0,
  [double]$Period = 20
)

Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading;

public static class SyntheticSource {
  [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint ms);
  [DllImport("kernel32.dll")] static extern void GetSystemTimePreciseAsFileTime(out long ft);

  static double WallSeconds() {
    long ft; GetSystemTimePreciseAsFileTime(out ft);
    return (ft - 116444736000000000L) / 1e7; // Unix epoch seconds
  }

  // Fraction of [a, b] that lies inside a flash window [k*period, k*period + 0.25].
  static double FlashOverlap(double a, double b, double period) {
    double total = 0;
    for (double k = Math.Floor(a / period); k * period <= b; k++) {
      double s = Math.Max(a, k * period), e = Math.Min(b, k * period + 0.25);
      if (e > s) total += e - s;
    }
    return total / (b - a);
  }

  static void WaitUntil(Stopwatch sw, double t) {
    while (true) {
      double left = t - sw.Elapsed.TotalSeconds;
      if (left <= 0) return;
      if (left > 0.002) Thread.Sleep(1); else Thread.SpinWait(50);
    }
  }

  static NetworkStream Accept(int port) {
    var listener = new TcpListener(IPAddress.Loopback, port);
    listener.Start();
    Console.WriteLine("listening");
    Console.Out.Flush();
    var client = listener.AcceptTcpClient();
    client.NoDelay = true;
    listener.Stop();
    return client.GetStream();
  }

  public static void Video(int port, int w, int h, double fps, double speed, double period) {
    timeBeginPeriod(1);
    var stream = Accept(port);
    // NV12: Y plane, then interleaved UV at half resolution (neutral grey chroma).
    var frame = new byte[w * h * 3 / 2];
    for (int i = w * h; i < frame.Length; i++) frame[i] = 128;
    double dt = 1.0 / fps;
    var sw = Stopwatch.StartNew();
    for (long n = 0; ; n++) {
      WaitUntil(sw, n * dt / speed);
      double now = WallSeconds();
      double f = FlashOverlap(now - dt, now, period);
      byte bg = (byte)(40 + 200 * f);
      for (int i = 0; i < w * h; i++) frame[i] = bg;
      int bar = (int)(n % w); // a moving bar so the encoder has motion to chew on
      for (int y = 0; y < h; y++) frame[y * w + bar] = 255;
      try { stream.Write(frame, 0, frame.Length); } catch { return; }
    }
  }

  public static void Audio(int port, double speed, double period) {
    timeBeginPeriod(1);
    var stream = Accept(port);
    const int rate = 48000, chunk = 48; // 1 ms of stereo s16
    var buf = new byte[chunk * 4];
    var sw = Stopwatch.StartNew();
    long sample = 0;
    for (long n = 0; ; n++) {
      WaitUntil(sw, (n + 1) * (double)chunk / rate / speed);
      double now = WallSeconds();
      for (int i = 0; i < chunk; i++, sample++) {
        double t = now - (double)(chunk - i) / rate / speed; // when this sample was "heard"
        double inBeep = (t - Math.Floor(t / period) * period) < 0.25 ? 1 : 0;
        short v = (short)(inBeep * 16000 * Math.Sin(2 * Math.PI * 1000 * sample / rate));
        buf[i * 4] = (byte)v; buf[i * 4 + 1] = (byte)(v >> 8);
        buf[i * 4 + 2] = (byte)v; buf[i * 4 + 3] = (byte)(v >> 8);
      }
      try { stream.Write(buf, 0, buf.Length); } catch { return; }
    }
  }
}
"@

if ($Kind -eq "video") { [SyntheticSource]::Video($Port, $Width, $Height, $Fps, $Speed, $Period) }
else { [SyntheticSource]::Audio($Port, $Speed, $Period) }
