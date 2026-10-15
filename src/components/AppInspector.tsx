import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useCallback, useEffect, useState } from "react";
import { appSessions } from "../lib/app-sessions";
import type { AppElement } from "../../shared/sessions";
import { formatError } from "../utils";

export function AppInspector({
  id,
  width,
  height,
  onClose,
}: {
  id: string;
  width: number;
  height: number;
  onClose: () => void;
}) {
  const [elements, setElements] = useState<AppElement[]>([]);
  const [xml, setXml] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState("");
  const [text, setText] = useState("");
  const [resolution, setResolution] = useState({ width, height });
  useEffect(() => setResolution({ width, height }), [width, height]);
  const resize = async () => {
    setBusy(true);
    setError("");
    try {
      await appSessions.update(id, resolution);
      await refresh();
    } catch (error) {
      setError(formatError(error));
    } finally {
      setBusy(false);
    }
  };
  const [coordinates, setCoordinates] = useState({
    x: 0,
    y: 0,
    endX: 0,
    endY: 0,
    duration: 300,
  });
  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const result = await appSessions.elements(id);
      setElements(result.elements);
      setXml(result.xml);
      setSelected("");
    } catch (error) {
      setError(formatError(error));
    } finally {
      setBusy(false);
    }
  }, [id]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const download = (data: Blob, name: string) => {
    const url = URL.createObjectURL(data);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const screenshot = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/app-sessions/${id}/screenshot`);
      if (!response.ok)
        throw new Error((await response.json()).message || "截图失败");
      download(await response.blob(), `app-${id}.jpg`);
    } catch (error) {
      setError(formatError(error));
    } finally {
      setBusy(false);
    }
  };
  const act = async (body: object) => {
    setBusy(true);
    setError("");
    try {
      await appSessions.action(id, body);
      await refresh();
    } catch (error) {
      setError(formatError(error));
    } finally {
      setBusy(false);
    }
  };
  const visible = elements.filter(
    (element) =>
      element.visible &&
      `${element.text} ${element.resourceId} ${element.description} ${element.id}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <aside className="app-inspector" aria-label="应用页面与元素">
      <header>
        <strong>页面与元素</strong>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={onClose}
          aria-label="关闭元素面板"
        >
          ×
        </Button>
      </header>
      <code title={id}>{id}</code>
      <small>
        原始坐标 {width} × {height} · 与 CLI 共用此会话
      </small>
      <div className="inspector-toolbar">
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={busy}
          onClick={() => void screenshot()}
        >
          保存截图
        </Button>
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={busy || !xml}
          onClick={() =>
            download(
              new Blob([xml], { type: "application/xml" }),
              `app-${id}.xml`,
            )
          }
        >
          导出 XML
        </Button>
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
        >
          刷新元素
        </Button>
      </div>
      <details>
        <summary>显示分辨率</summary>
        <div className="inspector-coordinate-grid">
          {(["width", "height"] as const).map((key) => (
            <label key={key}>
              {key === "width" ? "宽度" : "高度"}
              <Input
                aria-label={`应用显示${key === "width" ? "宽度" : "高度"}`}
                type="number"
                min={320}
                max={2560}
                step={1}
                value={resolution[key]}
                onChange={(event) =>
                  setResolution((current) => ({
                    ...current,
                    [key]: Number(event.currentTarget.value),
                  }))
                }
              />
            </label>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={busy}
          onClick={() => void resize()}
        >
          应用分辨率
        </Button>
      </details>
      <details>
        <summary>坐标与按键</summary>
        <div className="inspector-coordinate-grid">
          {(["x", "y", "endX", "endY", "duration"] as const).map((key) => (
            <label key={key}>
              {
                {
                  x: "起点 X",
                  y: "起点 Y",
                  endX: "终点 X",
                  endY: "终点 Y",
                  duration: "时长 ms",
                }[key]
              }
              <Input
                type="number"
                min="0"
                step="1"
                value={coordinates[key]}
                onChange={(event) =>
                  setCoordinates((current) => ({
                    ...current,
                    [key]: Number(event.currentTarget.value),
                  }))
                }
              />
            </label>
          ))}
        </div>
        <div className="inspector-toolbar">
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={busy}
            onClick={() =>
              void act({ type: "tap", x: coordinates.x, y: coordinates.y })
            }
          >
            点击坐标
          </Button>
          <Button
            variant="outline"
            size="sm"
            type="button"
            disabled={busy}
            onClick={() => void act({ type: "swipe", ...coordinates })}
          >
            滑动
          </Button>
          {[
            ["返回", 4],
            ["主页", 3],
            ["回车", 66],
            ["Tab", 61],
            ["退格", 67],
            ["最近应用", 187],
          ].map(([label, keyCode]) => (
            <Button
              variant="outline"
              size="sm"
              key={keyCode}
              type="button"
              disabled={busy}
              onClick={() => void act({ type: "key", keyCode })}
            >
              {label}
            </Button>
          ))}
        </div>
      </details>
      <Input
        aria-label="筛选应用元素"
        placeholder={`搜索 ${elements.length} 个元素…`}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <div className="inspector-elements" aria-busy={busy}>
        {visible.slice(0, 300).map((element) => (
          <Button
            variant="outline"
            size="sm"
            type="button"
            key={element.id}
            className={selected === element.id ? "selected" : ""}
            onClick={() => setSelected(element.id)}
            disabled={!element.enabled}
          >
            <strong>
              {element.text ||
                element.description ||
                element.className.split(".").at(-1)}
            </strong>
            <code>
              {element.id} · {element.resourceId || element.className}
            </code>
            <small>
              [{element.bounds.join(", ")}] {element.clickable ? "可点击" : ""}{" "}
              {element.editable ? "可输入" : ""}
            </small>
          </Button>
        ))}
        {!busy && !visible.length ? (
          <p>没有匹配元素。Canvas 页面可通过截图坐标操作。</p>
        ) : null}
      </div>
      <div className="inspector-toolbar">
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={busy || !selected}
          onClick={() => void act({ type: "clickElement", nodeId: selected })}
        >
          点击选中元素
        </Button>
      </div>
      <Textarea
        aria-label="应用元素输入文字"
        maxLength={4096}
        placeholder="输入文字；未选元素时发送到焦点输入框"
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
      />
      <Button
        variant="outline"
        size="sm"
        type="button"
        disabled={busy || !text}
        onClick={() =>
          void act({
            type: "setText",
            value: text,
            ...(selected ? { nodeId: selected } : {}),
          })
        }
      >
        发送文字
      </Button>
      {error ? (
        <div className="inline-error" role="alert">
          {error}
        </div>
      ) : null}
    </aside>
  );
}
