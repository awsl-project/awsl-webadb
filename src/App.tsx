import { useCallback, useEffect, useRef, useState } from "react";

import { AndroidKeyCode } from "@yume-chan/scrcpy";

import type { PanelView } from "./types";
import { useToast } from "./hooks/useToast";
import { useDevices } from "./hooks/useDevices";
import { useMirror } from "./hooks/useMirror";
import { useFiles } from "./hooks/useFiles";
import { ConnectView } from "./components/ConnectView";
import { FilesView } from "./components/FilesView";
import { MirrorSidebar, MirrorDisplay } from "./components/MirrorView";
import { Toast } from "./components/Toast";
import { UploadDialog } from "./components/UploadDialog";

export default function App() {
  const [panelView, setPanelView] = useState<PanelView>("mirror");
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [message, setMessage] = useState("正在连接后端 bridge。");
  const mirrorStageRef = useRef<HTMLElement | null>(null);
  const [mirrorStageHeight, setMirrorStageHeight] = useState<number | null>(
    null,
  );

  const { toast, showToast, dismissToast } = useToast();

  const showMessage = useCallback(
    (msg: string) => {
      setMessage(msg);
      showToast(msg);
    },
    [showToast],
  );

  const devicesHook = useDevices(showMessage);
  const mirror = useMirror(
    devicesHook.selectedTransportId,
    isCompactViewport,
    showMessage,
    panelView,
  );
  const files = useFiles(
    devicesHook.selectedTransportId,
    devicesHook.withDevice,
    showMessage,
  );

  // Compact viewport detection
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 900px), (pointer: coarse)");
    const update = () => setIsCompactViewport(mq.matches);

    update();
    mq.addEventListener("change", update);

    return () => mq.removeEventListener("change", update);
  }, []);

  // Close quality menu when leaving mirror view
  useEffect(() => {
    if (panelView !== "mirror") {
      mirror.setMirrorQualityMenuOpen(false);
    }
  }, [panelView]);

  // Load files when switching to files view
  useEffect(() => {
    if (panelView !== "files" || !devicesHook.selectedTransportId) {
      return;
    }

    void files.refreshFiles(undefined, true);
  }, [panelView, devicesHook.selectedTransportId]);

  // Stage height tracking
  useEffect(() => {
    const updateStageHeight = () => {
      const el = mirrorStageRef.current;
      if (!el) {
        return;
      }

      const rect = el.getBoundingClientRect();
      const vh = window.visualViewport?.height ?? window.innerHeight;
      const vot = window.visualViewport?.offsetTop ?? 0;
      setMirrorStageHeight(Math.max(vh + vot - rect.top, 320));
    };

    updateStageHeight();
    window.addEventListener("resize", updateStageHeight);
    window.visualViewport?.addEventListener("resize", updateStageHeight);
    window.visualViewport?.addEventListener("scroll", updateStageHeight);

    return () => {
      window.removeEventListener("resize", updateStageHeight);
      window.visualViewport?.removeEventListener("resize", updateStageHeight);
      window.visualViewport?.removeEventListener("scroll", updateStageHeight);
    };
  }, []);

  const handleSelectDevice = useCallback(
    (device: { transportId: bigint; serial: string }) => {
      const nextId = device.transportId.toString();
      if (nextId !== devicesHook.selectedTransportId) {
        void mirror.stopMirrorSession();
      }
      devicesHook.setSelectedTransportId(nextId);
      setPanelView("mirror");
      showMessage(`已选择设备 ${device.serial}`);
    },
    [devicesHook.setSelectedTransportId, devicesHook.selectedTransportId, mirror.stopMirrorSession, showMessage],
  );

  const handleConnect = useCallback(
    async (address: string) => {
      const matched = await devicesHook.connectNewDevice(address);
      if (matched) {
        setPanelView("mirror");
      }
    },
    [devicesHook.connectNewDevice],
  );

  const handleRequestMirrorStart = useCallback(() => {
    setPanelView("mirror");
    mirror.requestMirrorStart();
  }, [mirror.requestMirrorStart]);

  const isBusy =
    Boolean(devicesHook.pendingAction) || Boolean(mirror.mirrorPending);

  return (
    <main className="app-shell screen-shell">
      <section className="workspace">
        <section className="content-panel screen-content-panel">
          <section
            ref={mirrorStageRef}
            className="mirror-stage"
            style={
              mirrorStageHeight
                ? { height: `${mirrorStageHeight}px` }
                : undefined
            }
          >
            <div className="screen-layout">
              <aside className="screen-sidebar">
                <div className="screen-sidebar-group">
                  <div className="screen-icon-column">
                    <button
                      className={`ghost-button screen-icon-button ${panelView === "mirror" ? "active" : ""}`}
                      onClick={() => setPanelView("mirror")}
                      disabled={isBusy}
                      aria-label="屏幕"
                      title="屏幕"
                    >
                      <span className="material-symbols-rounded">
                        phone_android
                      </span>
                    </button>
                    <button
                      className={`ghost-button screen-icon-button ${panelView === "connect" ? "active" : ""}`}
                      onClick={() => setPanelView("connect")}
                      disabled={isBusy}
                      aria-label="连接"
                      title="连接"
                    >
                      <span className="material-symbols-rounded">link</span>
                    </button>
                    <button
                      className={`ghost-button screen-icon-button ${panelView === "files" ? "active" : ""}`}
                      onClick={() => setPanelView("files")}
                      disabled={isBusy}
                      aria-label="文件"
                      title="文件"
                    >
                      <span className="material-symbols-rounded">folder</span>
                    </button>
                  </div>
                </div>

                {panelView === "mirror" ? (
                  <MirrorSidebar
                    mirrorPending={mirror.mirrorPending}
                    mirrorRunning={mirror.mirrorRunning}
                    mirrorQuality={mirror.mirrorQuality}
                    mirrorQualityMenuOpen={mirror.mirrorQualityMenuOpen}
                    setMirrorQualityMenuOpen={mirror.setMirrorQualityMenuOpen}
                    pendingAction={devicesHook.pendingAction}
                    selectedDevice={devicesHook.selectedDevice}
                    onRequestStart={handleRequestMirrorStart}
                    onStop={() => {
                      void mirror.stopMirrorSession();
                    }}
                    onUpdateQuality={mirror.updateMirrorQuality}
                    onPressBack={() => {
                      void mirror.pressAndroidKey(AndroidKeyCode.AndroidBack);
                    }}
                    onPressHome={() => {
                      void mirror.pressAndroidKey(AndroidKeyCode.AndroidHome);
                    }}
                    onPressAppSwitch={() => {
                      void mirror.pressAndroidKey(
                        AndroidKeyCode.AndroidAppSwitch,
                      );
                    }}
                    onRotate={mirror.rotateDevice}
                  />
                ) : null}
              </aside>

              {panelView === "connect" ? (
                <ConnectView
                  devices={devicesHook.devices}
                  selectedDevice={devicesHook.selectedDevice}
                  selectedTransportId={devicesHook.selectedTransportId}
                  pendingAction={devicesHook.pendingAction}
                  mirrorPending={mirror.mirrorPending}
                  onSelectDevice={handleSelectDevice}
                  onConnect={handleConnect}
                  onPair={devicesHook.pairWirelessDevice}
                />
              ) : null}

              {panelView === "files" ? (
                <FilesView
                  selectedDevice={devicesHook.selectedDevice}
                  filesPath={files.filesPath}
                  filesEntries={files.filesEntries}
                  filesPending={files.filesPending}
                  fileUploadDialogOpen={files.fileUploadDialogOpen}
                  setFileUploadDialogOpen={files.setFileUploadDialogOpen}
                  uploadInputRef={files.uploadInputRef}
                  onRefresh={files.refreshFiles}
                  onOpen={files.openFileEntry}
                  onDownload={files.downloadFileEntry}
                  onUpload={files.uploadFiles}
                />
              ) : null}

              {panelView === "mirror" ? (
                <MirrorDisplay
                  canvasRef={mirror.canvasRef}
                  activeMirrorViewport={mirror.activeMirrorViewport}
                  mirrorRunning={mirror.mirrorRunning}
                  mirrorPending={mirror.mirrorPending}
                  message={message}
                  onPointerDown={(e) => {
                    void mirror.handlePointerDown(e);
                  }}
                  onPointerMove={(e) => {
                    void mirror.handlePointerMove(e);
                  }}
                  onPointerUp={(e) => {
                    void mirror.handlePointerUp(e);
                  }}
                />
              ) : null}
            </div>
          </section>
        </section>
      </section>

      {files.fileUploadDialogOpen ? (
        <UploadDialog
          filesPath={files.filesPath}
          uploadInputRef={files.uploadInputRef}
          onUpload={files.uploadFiles}
          onClose={() => {
            files.setFileUploadDialogOpen(false);
          }}
        />
      ) : null}

      <Toast toast={toast} onDismiss={dismissToast} />
    </main>
  );
}
