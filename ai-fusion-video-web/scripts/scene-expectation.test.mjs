import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/scene-expectation.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const { stripBakedSpatialAnchors } = await import(
  "data:text/javascript;base64," + Buffer.from(outputText).toString("base64")
);

// 全角方括号用 fromCharCode 构造（字面量在落盘时会被清洗）
const LBR = String.fromCharCode(0x3010);
const RBR = String.fromCharCode(0x3011);
const ANCHOR = `${LBR}空间锚点${RBR}`;
const CAMERA = `${LBR}机位方位${RBR}`;
const ROLES = `${LBR}人物站位${RBR}`;
const TAIL = "同一场景内上述锚点位置、机位方位与主体站位全程恒定，不得随镜头改变。";

test("removes a baked anchor block appended after a pure expectation", () => {
  const input =
    "夜晚，祭骨坛，火光摇曳。" +
    `${ANCHOR}场景为祭骨坛。P1（中央刑柱）＝画面正中；` +
    `${CAMERA}C1（坛沿平视）＝刑柱居中；` +
    `${ROLES}沈砚：位于P1，面朝南。` +
    TAIL;
  assert.equal(stripBakedSpatialAnchors(input), "夜晚，祭骨坛，火光摇曳。");
});

test("leaves a pure expectation untouched", () => {
  const input = "夜晚，祭骨坛，火光摇曳，氛围肃杀。";
  assert.equal(stripBakedSpatialAnchors(input), input);
});

test("removes Space: lines but keeps other lines", () => {
  const input = "Space: P1 central pillar, torches around\n夜晚祭骨坛";
  assert.equal(stripBakedSpatialAnchors(input), "夜晚祭骨坛");
});

test("handles nullish and blank input", () => {
  assert.equal(stripBakedSpatialAnchors(null), "");
  assert.equal(stripBakedSpatialAnchors(undefined), "");
  assert.equal(stripBakedSpatialAnchors(""), "");
  assert.equal(stripBakedSpatialAnchors("   "), "");
});

test("removes a standalone anchor block (whole field is baked)", () => {
  const input = `${ANCHOR}场景为祭骨坛。P1（中央刑柱）＝画面正中。`;
  assert.equal(stripBakedSpatialAnchors(input), "");
});

test("removes the anchor section and treats the rest as baked", () => {
  const input = `开头期望。${CAMERA}C2＝仰拍；${ROLES}沈砚：位于P1，面朝南。`;
  assert.equal(stripBakedSpatialAnchors(input), "开头期望。");
});
