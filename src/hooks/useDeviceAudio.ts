import { useCallback, useEffect, useRef, useState } from "react";
import { AdbScrcpyOptionsLatest } from "@yume-chan/adb-scrcpy";
import { ScrcpyInstanceId } from "@yume-chan/scrcpy";
import { adbClient } from "../lib/adb-client";
import { startScrcpyServer, scrcpyServerVersion } from "../lib/scrcpy-server";
import { ScrcpyPcmAudioPlayer } from "../lib/scrcpy-audio-player";
import type { AdbConnection, MirrorSession } from "../types";

export function useDeviceAudio(
  transportId: string,
  deviceId: string,
  onError: (message: string) => void,
) {
  const [playing, setPlaying] = useState(false);
  const session = useRef<{
    adb: AdbConnection;
    client: MirrorSession["client"];
    player: ScrcpyPcmAudioPlayer;
    abort: AbortController;
    timer: number;
    leaseId: string;
    deviceId: string;
  } | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const lease = async (key: string, leaseId: string, release = false) => {
    const response = await fetch(
      `/api/audio-lease${release ? "/release" : ""}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: key, leaseId }),
        keepalive: release,
      },
    );
    if (!response.ok) throw new Error("音频服务不可用");
    return response.json() as Promise<{ granted?: boolean }>;
  };
  const stop = useCallback(async () => {
    generation.current++;
    const current = session.current;
    session.current = null;
    setPlaying(false);
    if (!current) return;
    clearInterval(current.timer);
    current.abort.abort();
    current.player.dispose();
    await Promise.allSettled([
      current.client.close(),
      current.adb.close(),
      lease(current.deviceId, current.leaseId, true),
    ]);
  }, []);
  useEffect(() => {
    const hide = () => {
      void stop();
    };
    window.addEventListener("pagehide", hide);
    return () => {
      window.removeEventListener("pagehide", hide);
      void stop();
    };
  }, [transportId, stop]);
  const toggle = useCallback(async () => {
    if (session.current) {
      await stop();
      return;
    }
    if (pending.current || !transportId) return;
    pending.current = true;
    const token = ++generation.current;
    const key =
      deviceId.match(/^adb-(.+)-[^-]+\._adb-tls-connect\._tcp$/)?.[1] ||
      deviceId ||
      transportId;
    const leaseId = crypto.randomUUID();
    let adb: AdbConnection | undefined;
    let client: MirrorSession["client"] | undefined;
    let player: ScrcpyPcmAudioPlayer | undefined;
    const assertCurrent = () => {
      if (generation.current !== token) throw new Error("音频启动已取消");
    };
    try {
      if (!(await lease(key, leaseId)).granted)
        throw new Error("另一个页面正在播放手机声音，请先在那里停止");
      assertCurrent();
      adb = await adbClient.createAdb({ transportId: BigInt(transportId) });
      assertCurrent();
      client = await startScrcpyServer(
        adb,
        new AdbScrcpyOptionsLatest(
          {
            video: false,
            videoCodec: "h264",
            audio: true,
            audioCodec: "raw",
            audioSource: "output",
            control: false,
            tunnelForward: true,
            cleanup: true,
            sendDeviceMeta: false,
            scid: ScrcpyInstanceId.random(),
          },
          { version: scrcpyServerVersion },
        ),
        assertCurrent,
      );
      const stream = await client.audioStream;
      assertCurrent();
      if (!stream || stream.type !== "success")
        throw new Error("手机没有返回音频流");
      player = new ScrcpyPcmAudioPlayer(false);
      await player.resume();
      assertCurrent();
      const abort = new AbortController();
      const current = {
        adb,
        client,
        player,
        abort,
        timer: 0,
        deviceId: key,
        leaseId,
      };
      current.timer = window.setInterval(() => {
        void lease(key, leaseId)
          .then((result) => {
            if (!result.granted && session.current === current) void stop();
          })
          .catch(() => {
            if (session.current === current) void stop();
          });
      }, 5000);
      session.current = current;
      setPlaying(true);
      void player
        .play(stream.stream, abort.signal)
        .catch(() => undefined)
        .finally(() => {
          if (session.current === current) void stop();
        });
    } catch (error) {
      player?.dispose();
      await Promise.allSettled([
        client?.close(),
        adb?.close(),
        lease(key, leaseId, true),
      ]);
      if (generation.current === token) onError(String(error));
    } finally {
      pending.current = false;
    }
  }, [deviceId, onError, stop, transportId]);
  return { playing, toggle, stop };
}
