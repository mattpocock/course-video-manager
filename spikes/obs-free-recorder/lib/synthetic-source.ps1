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
#
# -Kind marker is for the real-screen selftest (ddagrab): a small borderless,
# topmost, never-activated square on DXGI output -Output (the same index ddagrab
# uses), black, turning white for 250 ms on the same wall-clock boundaries.
param(
  [ValidateSet("video", "audio", "marker")][string]$Kind,
  [int]$Port,
  [int]$Width = 320,
  [int]$Height = 180,
  [double]$Fps = 60,
  [double]$Speed = 1.0,
  [double]$Period = 20,
  [int]$Output = 0,
  [int]$X = 16,
  [int]$Y = 16,
  [int]$Size = 64
)

Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading;

// DXGI, only to find where ddagrab's output N sits on the desktop. ddagrab
// opens the default adapter, so output N is adapter 0's Nth output. Methods
// before the ones used are vtable placeholders and are never called.
[ComImport, Guid("7b7166ec-21c7-44ae-b21a-c9ae321ae369"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IDXGIFactory {
  void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
  [PreserveSig] int EnumAdapters(uint index, out IDXGIAdapter adapter);
}
[ComImport, Guid("2411e7e1-12ac-4ccf-bd14-9798e8534dc0"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IDXGIAdapter {
  void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
  [PreserveSig] int EnumOutputs(uint index, out IDXGIOutput output);
}
[ComImport, Guid("ae02eedb-c735-4690-8d52-5a8dc20213aa"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IDXGIOutput {
  void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
  [PreserveSig] int GetDesc(out DxgiOutputDesc desc);
}
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct DxgiOutputDesc {
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
  public int Left, Top, Right, Bottom;
  public int AttachedToDesktop, Rotation;
  public IntPtr Monitor;
}

public class MarkerForm : Form {
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams {
    get {
      var cp = base.CreateParams;
      cp.ExStyle |= 0x08000000 | 0x80 | 0x8; // NOACTIVATE | TOOLWINDOW | TOPMOST
      return cp;
    }
  }
}

public static class SyntheticSource {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out object factory);

  static DxgiOutputDesc OutputDesc(int idx) {
    var iid = new Guid("770aae78-f26f-4dba-a829-253c83d1b387"); // IDXGIFactory1
    object f;
    Marshal.ThrowExceptionForHR(CreateDXGIFactory1(ref iid, out f));
    IDXGIAdapter adapter;
    Marshal.ThrowExceptionForHR(((IDXGIFactory)f).EnumAdapters(0, out adapter));
    IDXGIOutput output;
    Marshal.ThrowExceptionForHR(adapter.EnumOutputs((uint)idx, out output));
    DxgiOutputDesc d;
    Marshal.ThrowExceptionForHR(output.GetDesc(out d));
    return d;
  }

  static void SleepUntilWall(double t) {
    while (true) {
      double left = t - WallSeconds();
      if (left <= 0) return;
      if (left > 0.002) Thread.Sleep(1); else Thread.SpinWait(50);
    }
  }

  public static void Marker(int outputIdx, int x, int y, int size, double period) {
    timeBeginPeriod(1);
    SetProcessDPIAware(); // desktop coordinates in physical pixels, as ddagrab sees them
    var d = OutputDesc(outputIdx);
    var form = new MarkerForm();
    form.FormBorderStyle = FormBorderStyle.None;
    form.StartPosition = FormStartPosition.Manual;
    form.ShowInTaskbar = false;
    form.TopMost = true;
    form.BackColor = Color.Black;
    form.Bounds = new Rectangle(d.Left + x, d.Top + y, size, size);
    Action<Color> set = c => form.BeginInvoke((Action)(() => { form.BackColor = c; form.Refresh(); }));
    var flasher = new Thread(() => {
      while (true) {
        double on = (Math.Floor(WallSeconds() / period) + 1) * period;
        SleepUntilWall(on);
        set(Color.White);
        SleepUntilWall(on + 0.25);
        set(Color.Black);
      }
    });
    flasher.IsBackground = true;
    form.Shown += (s, e) => {
      Console.WriteLine("listening: marker on " + d.DeviceName + " at " + (d.Left + x) + "," + (d.Top + y));
      Console.Out.Flush();
      flasher.Start();
    };
    Application.Run(form);
  }

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
elseif ($Kind -eq "marker") { [SyntheticSource]::Marker($Output, $X, $Y, $Size, $Period) }
else { [SyntheticSource]::Audio($Port, $Speed, $Period) }
