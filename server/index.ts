import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

import { AdbServerClient } from "@yume-chan/adb";
import { AdbServerNodeTcpConnector } from "@yume-chan/adb-server-node-tcp";
import express from "express";
import { WebSocketServer } from "ws";

const app = express();
const server = createServer(app);

const webPort = toInteger(process.env.PORT, 3000);
const webHost = process.env.HOST ?? "0.0.0.0";
const adbHost = process.env.ADB_SERVER_HOST ?? "127.0.0.1";
const adbPort = toInteger(process.env.ADB_SERVER_PORT, 5037);
const adbTarget = `${adbHost}:${adbPort}`;

const connector = new AdbServerNodeTcpConnector({
  host: adbHost,
  port: adbPort,
});
const adbClient = new AdbServerClient(connector);
const trackedStates = ["device", "offline", "unauthorized"] as const;

const bridge = new WebSocketServer({
  noServer: true,
  perMessageDeflate: false,
});

function toInteger(value: string | undefined, fallback: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return parsed;
}

function closeWithReason(
  socket: import("ws").WebSocket,
  code: number,
  reason: string,
) {
  const text = reason.slice(0, 120);
  if (socket.readyState === socket.OPEN) {
    socket.close(code, text);
    return;
  }

  socket.terminate();
}

app.get("/api/health", async (_request, response) => {
  try {
    const [version, devices] = await Promise.all([
      adbClient.getVersion(),
      adbClient.getDevices(trackedStates),
    ]);

    response.json({
      status: "ok",
      adbServer: adbTarget,
      versionHex: version.toString(16).padStart(8, "0"),
      deviceCount: devices.length,
    });
  } catch (error) {
    response.status(503).json({
      status: "error",
      adbServer: adbTarget,
      message: error instanceof Error ? error.message : String(error),
    });
  }
});

bridge.on("connection", (webSocket) => {
  const adbSocket = new net.Socket();
  adbSocket.setNoDelay(true);

  let bridgeClosed = false;

  function destroyBridge(code: number, reason: string) {
    if (bridgeClosed) {
      return;
    }

    bridgeClosed = true;
    adbSocket.destroy();
    closeWithReason(webSocket, code, reason);
  }

  adbSocket.on("data", (chunk) => {
    if (webSocket.readyState !== webSocket.OPEN) {
      return;
    }

    webSocket.send(chunk, { binary: true });
  });

  adbSocket.on("error", (error) => {
    destroyBridge(1011, error.message || "ADB bridge error");
  });

  adbSocket.on("close", (hadError) => {
    if (bridgeClosed) {
      return;
    }

    destroyBridge(hadError ? 1011 : 1000, hadError ? "ADB socket error" : "ADB socket closed");
  });

  webSocket.on("message", (chunk, isBinary) => {
    if (!isBinary) {
      destroyBridge(1003, "Binary frames only");
      return;
    }

    if (adbSocket.destroyed) {
      destroyBridge(1011, "ADB socket unavailable");
      return;
    }

    adbSocket.write(chunk as Buffer);
  });

  webSocket.on("close", () => {
    bridgeClosed = true;
    adbSocket.destroy();
  });

  webSocket.on("error", () => {
    bridgeClosed = true;
    adbSocket.destroy();
  });

  adbSocket.connect({
    host: adbHost,
    port: adbPort,
  });
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  if (url.pathname !== "/ws/adb") {
    socket.destroy();
    return;
  }

  bridge.handleUpgrade(request, socket, head, (webSocket) => {
    bridge.emit("connection", webSocket, request);
  });
});

const distDir = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api\/).*/, (_request, response) => {
    response.sendFile(resolve(distDir, "index.html"));
  });
}

server.listen(webPort, webHost, () => {
  console.log(`ADB bridge ready at http://${webHost}:${webPort}`);
  console.log(`Forwarding browser WebSocket traffic to adb server ${adbTarget}`);
});
