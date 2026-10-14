/**
 * 把页面里的 SVG 渲染成 PNG。
 *
 * 用于把空间俯视图存成资产图 —— 图由锚点数据确定性算出，导出只是把同一份数据
 * 换个载体（每次导出结果一致，可复现、可对账）。
 */

interface RenderOptions {
  /** 输出边长（正方形） */
  size?: number;
  /** 底色；俯视图底下垫白，避免存下来是透明底 */
  background?: string;
}

export async function renderSvgToPngBlob(
  svg: SVGSVGElement,
  { size = 1024, background = "#ffffff" }: RenderOptions = {}
): Promise<Blob> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(size));
  clone.setAttribute("height", String(size));
  clone.setAttribute("viewBox", svg.getAttribute("viewBox") ?? `0 0 ${size} ${size}`);

  const xml = new XMLSerializer().serializeToString(clone);
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("SVG 渲染失败，无法导出"));
    image.src = source;
  });

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建画布上下文");
  context.fillStyle = background;
  context.fillRect(0, 0, size, size);
  context.drawImage(image, 0, 0, size, size);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png")
  );
  if (!blob) throw new Error("导出 PNG 失败");
  return blob;
}
