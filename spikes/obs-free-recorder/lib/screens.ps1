# Lists the DXGI outputs ddagrab can capture, by name. Metadata only: nothing is
# captured and no device is opened.
#
# ddagrab's output_idx counts the outputs of the first adapter (D3D11's default
# device), so this walks IDXGIFactory1 -> adapter 0 -> EnumOutputs(i) in the same
# order. Each output's \\.\DISPLAYn is matched to its monitor (EDID name from
# WmiMonitorID) through EnumDisplayDevices' device-interface path.
#
# One tab-separated line per output: idx, x, y, width, height, \\.\DISPLAYn, name
# (x/y/width/height are physical desktop pixels).

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class RigScreens {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DXGI_OUTPUT_DESC {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
    public RECT DesktopCoordinates;
    [MarshalAs(UnmanagedType.Bool)] public bool AttachedToDesktop;
    public int Rotation;
    public IntPtr Monitor;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DISPLAY_DEVICE {
    public int cb;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString;
    public int StateFlags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey;
  }

  // Vtable order matters: IUnknown is implied, then IDXGIObject's 4 methods.
  [ComImport, Guid("770aae78-f26f-4dba-a829-253c83d1b387"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IDXGIFactory1 {
    void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
    [PreserveSig] int EnumAdapters(uint i, out IntPtr adapter);
    void MakeWindowAssociation(); void GetWindowAssociation(); void CreateSwapChain(); void CreateSoftwareAdapter();
    [PreserveSig] int EnumAdapters1(uint i, out IDXGIAdapter1 adapter);
  }
  [ComImport, Guid("29038f61-3839-4626-91fd-086879011a05"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IDXGIAdapter1 {
    void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
    [PreserveSig] int EnumOutputs(uint i, out IDXGIOutput output);
  }
  [ComImport, Guid("ae02eedb-c735-4690-8d52-5a8dc20213aa"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IDXGIOutput {
    void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
    [PreserveSig] int GetDesc(out DXGI_OUTPUT_DESC desc);
  }

  [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid riid, out IDXGIFactory1 factory);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  static extern bool EnumDisplayDevices(string device, uint i, ref DISPLAY_DEVICE dd, uint flags);

  public static string[] List() {
    var result = new System.Collections.Generic.List<string>();
    Guid iid = typeof(IDXGIFactory1).GUID;
    IDXGIFactory1 f;
    if (CreateDXGIFactory1(ref iid, out f) != 0) return result.ToArray();
    IDXGIAdapter1 a;
    if (f.EnumAdapters1(0, out a) != 0) return result.ToArray();
    for (uint i = 0; ; i++) {
      IDXGIOutput o;
      if (a.EnumOutputs(i, out o) != 0) break;
      DXGI_OUTPUT_DESC d;
      o.GetDesc(out d);
      var r = d.DesktopCoordinates;
      // EDD_GET_DEVICE_INTERFACE_NAME (1): DeviceID becomes \\?\DISPLAY#DELA233#5&...#{guid}
      var dd = new DISPLAY_DEVICE(); dd.cb = Marshal.SizeOf(dd);
      string id = EnumDisplayDevices(d.DeviceName, 0, ref dd, 1) ? dd.DeviceID : "";
      result.Add(i + "\t" + r.Left + "\t" + r.Top + "\t" + (r.Right - r.Left) + "\t" + (r.Bottom - r.Top) + "\t" + d.DeviceName + "\t" + id);
    }
    return result.ToArray();
  }
}
"@

# WmiMonitorID InstanceName DISPLAY\DELA233\5&89701ff&0&UID4352_0 <-> interface path \\?\DISPLAY#DELA233#5&89701ff&0&UID4352#{...}
$names = @{}
foreach ($m in Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorID -ErrorAction SilentlyContinue) {
  $key = ($m.InstanceName -replace '_\d+$', '').ToUpperInvariant()
  $names[$key] = (($m.UserFriendlyName | Where-Object { $_ -ne 0 } | ForEach-Object { [char]$_ }) -join '')
}
foreach ($line in [RigScreens]::List()) {
  $p = $line -split "`t"
  $key = ''
  if ($p[6] -match '^\\\\\?\\(.+)#\{') { $key = ($Matches[1] -replace '#', '\').ToUpperInvariant() }
  $name = if ($names.ContainsKey($key)) { $names[$key] } else { '?' }
  [Console]::Out.WriteLine(($p[0..5] -join "`t") + "`t" + $name)
}
