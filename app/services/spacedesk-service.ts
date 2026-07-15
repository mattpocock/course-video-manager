import { Data, Effect } from "effect";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * SpacedeskService opens the local spacedesk HTML5 viewer as a clean,
 * TikTok-shaped browser window that auto-connects to the spacedesk server.
 *
 * How it works (reverse-engineered from the viewer's bundled JS):
 * - The viewer is a static HTML page that opens a WebSocket to
 *   `ws://<server-ip>:28252` and renders the spacedesk display onto a canvas.
 * - Appending `?connectTo=<ip>` to the URL makes the viewer auto-connect on
 *   load (its `loadSettingsFromQuery` reads the `connectTo` query key, sets the
 *   server, and flips `queryConnect` so `connect()` fires without any clicking).
 * - The TikTok-shaped custom resolution is remembered in the viewer's own
 *   localStorage from the one-time Settings setup, so it persists across launches.
 *
 * We launch it through Chrome's `--app` mode so it opens as a borderless,
 * fixed-size window rather than a normal tab — a clean virtual monitor you can
 * drag windows onto.
 *
 * The server address matters: the spacedesk server binds to the machine's LAN
 * interface, not loopback, so connecting to 127.0.0.1 does NOT work. When no
 * address is configured we auto-detect the Windows host's LAN IPv4 (the address
 * on the adapter that owns the default gateway, e.g. 192.168.x.x). This is
 * queried against Windows via PowerShell because the CVM server runs inside WSL,
 * which has its own NAT IP and cannot see the Windows LAN address directly.
 *
 * Config (all optional, via env, with sensible defaults):
 * - SPACEDESK_VIEWER_PATH: WSL path to the viewer HTML file.
 * - SPACEDESK_SERVER_IP:   spacedesk server address (auto-detected LAN IP if unset).
 * - SPACEDESK_BROWSER:     browser executable to launch (default "chrome").
 * - SPACEDESK_WINDOW_SIZE: "<width>,<height>" of the window (default 1080,1920 —
 *   full-HD 1080p in TikTok portrait orientation).
 */

const DEFAULT_VIEWER_PATH =
  "/mnt/c/Users/mpoco/Documents/SpaceDesk/spacedesk HTML5 VIEWER.html";
const DEFAULT_BROWSER = "chrome";
const DEFAULT_WINDOW_SIZE = "1080,1920";

// The IPv4 address of the Up adapter that owns the default gateway — i.e. the
// real LAN connection (Wi-Fi/Ethernet), never the WSL vEthernet NAT adapter,
// which has no default gateway.
const DETECT_IP_COMMAND =
  `powershell.exe -NoProfile -Command ` +
  `"(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' }).IPv4Address.IPAddress"`;

const IPV4_PATTERN = /^\d{1,3}(\.\d{1,3}){3}$/;

export class SpacedeskError extends Data.TaggedError("SpacedeskError")<{
  cause: unknown;
  message: string;
}> {}

/** Detect the Windows host's LAN IPv4 by asking Windows over PowerShell. */
const detectServerIp = (): Effect.Effect<string, SpacedeskError> =>
  Effect.tryPromise({
    try: async () => {
      const { stdout } = await execAsync(DETECT_IP_COMMAND);
      const ip = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => IPV4_PATTERN.test(line));
      if (!ip) {
        throw new Error("no IPv4 address with a default gateway was found");
      }
      return ip;
    },
    catch: (e) =>
      new SpacedeskError({
        cause: e,
        message: `Couldn't auto-detect the spacedesk server's LAN IP — set SPACEDESK_SERVER_IP in your .env (e.g. 192.168.x.x). ${e}`,
      }),
  });

const wslPathToWindows = (
  wslPath: string
): Effect.Effect<string, SpacedeskError> =>
  Effect.tryPromise({
    try: async () => {
      const { stdout } = await execAsync(`wslpath -w "${wslPath}"`);
      return stdout.trim();
    },
    catch: (e) =>
      new SpacedeskError({
        cause: e,
        message: `Failed to convert viewer path to a Windows path: ${e}`,
      }),
  });

/** Build a `file:///` URL for the viewer with the auto-connect query param. */
const buildViewerUrl = (windowsPath: string, serverIp: string): string => {
  const fileUrl = "file:///" + windowsPath.replace(/\\/g, "/");
  return `${encodeURI(fileUrl)}?connectTo=${encodeURIComponent(serverIp)}`;
};

export class SpacedeskService extends Effect.Service<SpacedeskService>()(
  "SpacedeskService",
  {
    effect: Effect.gen(function* () {
      const openViewer = Effect.fn("openViewer")(function* () {
        const viewerPath =
          process.env.SPACEDESK_VIEWER_PATH || DEFAULT_VIEWER_PATH;
        const serverIp =
          process.env.SPACEDESK_SERVER_IP || (yield* detectServerIp());
        const browser = process.env.SPACEDESK_BROWSER || DEFAULT_BROWSER;
        const windowSize =
          process.env.SPACEDESK_WINDOW_SIZE || DEFAULT_WINDOW_SIZE;

        const windowsPath = yield* wslPathToWindows(viewerPath);
        const url = buildViewerUrl(windowsPath, serverIp);

        // Launch the viewer as a borderless app window via PowerShell's
        // Start-Process. The URL and flags are passed as separate ArgumentList
        // elements so the query string is handed to the browser verbatim.
        const command = `powershell.exe -c "Start-Process '${browser}' -ArgumentList '--app=${url}','--window-size=${windowSize}'"`;

        yield* Effect.tryPromise({
          try: async () => {
            await execAsync(command);
          },
          catch: (e) =>
            new SpacedeskError({
              cause: e,
              message: `Failed to launch the spacedesk viewer: ${e}`,
            }),
        });
      });

      return { openViewer };
    }),
  }
) {}
