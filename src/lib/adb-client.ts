import { AdbServerClient } from "@yume-chan/adb";

import { AdbServerWebSocketConnector } from "./adb-server-websocket";

export const adbClient = new AdbServerClient(
  new AdbServerWebSocketConnector(),
);
