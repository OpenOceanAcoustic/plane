/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadLabExport(url: string, filename: string) {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error("导出失败，请刷新后重试或检查权限");
  saveBlob(await response.blob(), filename);
}

/** Serialize the already-authorized SVG locally, without a remote image service. */
export async function exportChartPng(container: HTMLElement, title: string, subtitle: string) {
  const original = container.querySelector<SVGSVGElement>("[data-chart-canvas] svg");
  if (!original) throw new Error("图表尚未生成，无法导出图片");
  const copy = original.cloneNode(true) as SVGSVGElement;
  const originalNodes = [original, ...original.querySelectorAll("*")];
  const copiedNodes = [copy, ...copy.querySelectorAll("*")];
  const properties = ["fill", "stroke", "stroke-width", "font-family", "font-size", "font-weight", "opacity", "color"];
  originalNodes.forEach((node, index) => {
    const target = copiedNodes[index] as SVGElement | undefined;
    if (!target) return;
    const style = getComputedStyle(node);
    properties.forEach((property) => target.style.setProperty(property, style.getPropertyValue(property)));
  });
  const bounds = original.getBoundingClientRect();
  const sourceWidth = Math.max(1, Number(original.getAttribute("width")) || bounds.width);
  const sourceHeight = Math.max(1, Number(original.getAttribute("height")) || bounds.height);
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", String(sourceWidth));
  copy.setAttribute("height", String(sourceHeight));
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(copy)], { type: "image/svg+xml;charset=utf-8" })
  );
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new Error("图片生成失败")), { once: true });
      image.src = url;
    });
    const scale = Math.min(2, 4096 / sourceWidth, 4000 / sourceHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(sourceWidth * scale);
    const legend = [...container.querySelectorAll<HTMLElement>(".recharts-legend-item-text")].map((item) => ({
      label: item.textContent ?? "",
      color: getComputedStyle(item).color,
    }));
    const chartTop = legend.length ? 92 : 68;
    canvas.height = Math.ceil(sourceHeight * scale) + chartTop + 22;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器不支持图片导出");
    const style = getComputedStyle(container);
    context.fillStyle = style.backgroundColor === "rgba(0, 0, 0, 0)" ? "#ffffff" : style.backgroundColor;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = style.color;
    context.font = `600 20px ${style.fontFamily}`;
    context.fillText(title, 18, 30);
    context.font = `12px ${style.fontFamily}`;
    context.fillText(subtitle, 18, 52);
    let legendX = 18;
    for (const item of legend) {
      context.fillStyle = item.color;
      context.fillRect(legendX, 67, 10, 10);
      context.fillStyle = style.color;
      context.fillText(item.label, legendX + 16, 77);
      legendX += context.measureText(item.label).width + 34;
    }
    context.drawImage(image, 0, chartTop, sourceWidth * scale, sourceHeight * scale);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => {
        if (!value) {
          reject(new Error("图片生成失败"));
          return;
        }
        resolve(value);
      }, "image/png")
    );
    saveBlob(blob, `${title}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
