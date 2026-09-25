"use client";

import { useMemo, useState } from "react";

import { FORMAT_LABELS, MODEL_ACCEPT, ModelError, readModel, write3mf, writeGlb, writeObj, writePly, writeStl } from "@/lib/geometry/formats";
import { analyzeMesh, convertUp, scaleMesh, weld, type Mesh } from "@/lib/geometry/mesh";
import { previewPng } from "@/lib/geometry/render";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainOutputSpec, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("convert-3d-model");

const MAX_BYTES = 512 * 1024 * 1024;

type Target = "stl" | "3mf" | "obj" | "ply" | "glb";
type Scale = "keep" | "m-mm" | "mm-m" | "in-mm" | "cm-mm";

interface ConvertSettings {
  target: Target;
  scale: Scale;
  orient: boolean;
}

const TARGETS: { value: Target; label: string; blurb: string; up: Mesh["up"]; extension: string; mime: string }[] = [
  { value: "stl", label: "STL", blurb: "Every slicer and CAD program; geometry only", up: "z", extension: "stl", mime: "model/stl" },
  { value: "3mf", label: "3MF", blurb: "The modern printing format: units, smaller files", up: "z", extension: "3mf", mime: "model/3mf" },
  { value: "obj", label: "OBJ", blurb: "Blender, game engines and most 3D apps", up: "y", extension: "obj", mime: "model/obj" },
  { value: "ply", label: "PLY", blurb: "Scans and point-cloud software", up: "z", extension: "ply", mime: "application/octet-stream" },
  { value: "glb", label: "glTF (.glb)", blurb: "The web's 3D format: three.js, model viewers, AR", up: "y", extension: "glb", mime: "model/gltf-binary" },
];

const SCALES: { value: Scale; label: string; blurb: string; factor: number; unit: string | null }[] = [
  { value: "keep", label: "As it is", blurb: "The numbers unchanged", factor: 1, unit: null },
  { value: "m-mm", label: "Metres to millimetres", blurb: "x 1000: for glTF models that print tiny", factor: 1000, unit: "millimeter" },
  { value: "in-mm", label: "Inches to millimetres", blurb: "x 25.4: for models drawn in inches", factor: 25.4, unit: "millimeter" },
  { value: "cm-mm", label: "Centimetres to millimetres", blurb: "x 10", factor: 10, unit: "millimeter" },
  { value: "mm-m", label: "Millimetres to metres", blurb: "x 0.001: for printing models headed to the web", factor: 0.001, unit: "meter" },
];

function isSettings(value: unknown): value is ConvertSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ConvertSettings>;
  return TARGETS.some((target) => target.value === candidate.target) && SCALES.some((scale) => scale.value === candidate.scale) && typeof candidate.orient === "boolean";
}

const round = (value: number) => (Math.abs(value) >= 100 ? value.toFixed(1) : Math.abs(value) >= 1 ? value.toFixed(2) : value.toPrecision(3));

/** A 3D model in another format: STL, 3MF, OBJ, PLY or glTF, any to any. */
export function Convert3dModelApp() {
  const [settings, setSettings] = useState<ConvertSettings>({ target: "3mf", scale: "keep", orient: true });
  useStoredSettings(storageKey("settings", "convert-3d-model"), settings, setSettings, isSettings);

  const queue = useMemo<PlainQueueOptions<ConvertSettings>>(
    () => ({
      key: "convert-3d-model",
      settings,
      reject: (file) => (file.size === 0 ? { message: "This file is empty.", hint: "It is 0 bytes, which is not a model." } : file.size > MAX_BYTES ? { message: "This model is too large to convert in a browser tab.", hint: `This reads models up to ${formatBytes(MAX_BYTES)}.` } : null),
      run: async (file, current, report) => {
        report("Reading...", null);
        let read;
        try {
          read = readModel(new Uint8Array(await file.arrayBuffer()), file.name);
        } catch (error) {
          if (error instanceof ModelError) throw new PlainError(error.message, error.hint, { cause: error });
          throw error;
        }
        const target = TARGETS.find((entry) => entry.value === current.target)!;
        const scale = SCALES.find((entry) => entry.value === current.scale)!;
        if (read.format === current.target && current.scale === "keep") return { outputs: [], nothing: { message: `This is already ${FORMAT_LABELS[read.format]}.`, hint: "Choose another format above." } };
        report("Converting...", null);
        let mesh = weld(read.mesh);
        mesh = scaleMesh(mesh, scale.factor);
        if (scale.unit) mesh = { ...mesh, unit: scale.unit };
        const turned = current.orient && mesh.up !== target.up;
        mesh = current.orient ? convertUp(mesh, target.up) : { ...mesh, up: target.up };
        const data = target.value === "stl" ? writeStl(mesh) : target.value === "3mf" ? write3mf(mesh) : target.value === "obj" ? new TextEncoder().encode(writeObj(mesh)) : target.value === "ply" ? writePly(mesh) : writeGlb(mesh);
        const analysis = analyzeMesh(mesh);
        const unit = mesh.unit === "meter" ? "m" : mesh.unit === "millimeter" || mesh.unit === null ? "mm" : mesh.unit;
        const facts = [`Read as: ${FORMAT_LABELS[read.format]}`, `Triangles: ${analysis.triangles.toLocaleString("en")}, ${analysis.vertices.toLocaleString("en")} vertices`, `Size: ${analysis.size.map(round).join(" x ")} ${mesh.unit ? unit : "(units as in the file; slicers assume mm)"}`];
        if (mesh.parts.length > 1) facts.push(`Parts: ${mesh.parts.length}, ${mesh.parts.slice(0, 5).map((part) => part.name).join(", ")}${mesh.parts.length > 5 ? "..." : ""}`);
        const notes: string[] = [];
        if (turned) notes.push(`${FORMAT_LABELS[read.format]} stands models on ${read.mesh.up.toUpperCase()} and ${target.label} on ${target.up.toUpperCase()}, so the model was turned a quarter to stay upright.`);
        if (read.format === "glb" || read.format === "gltf") {
          if (current.scale === "keep" && (target.value === "stl" || target.value === "ply") && Math.max(...analysis.size) < 5) notes.push("glTF measures in metres and slicers read STL in millimetres, so this will print very small; choose Metres to millimetres above.");
          notes.push("Colours, textures and materials are left behind: only the shape converts.");
        }
        if (!analysis.watertight && (target.value === "stl" || target.value === "3mf")) notes.push("The model is not watertight, which slicers complain about; the repair tool can fix most of that.");
        const outputs: PlainOutputSpec[] = [{ label: `${target.label} model`, fileName: `${fileStem(file.name, "model")}.${target.extension}`, blob: new Blob([data as BlobPart], { type: target.mime }), kind: "file", note: `${formatBytes(data.length)} from ${formatBytes(file.size)}` }];
        report("Drawing a preview...", null);
        const preview = await previewPng(mesh, 640);
        if (preview) outputs.push({ label: "Preview", fileName: `${fileStem(file.name, "model")}-preview.png`, blob: preview, kind: "image", note: "Seen from above and to one side" });
        return { facts, notes, outputs };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Format & size",
    summary: () => `${TARGETS.find((target) => target.value === settings.target)?.label}${settings.scale !== "keep" ? `, ${SCALES.find((scale) => scale.value === settings.scale)?.label.toLowerCase()}` : ""}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Convert to</legend>
          <RadioCards aria-label="Convert to" value={settings.target} onValueChange={(value) => setSettings((previous) => ({ ...previous, target: value as Target }))} options={TARGETS} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Units</legend>
          <RadioCards aria-label="Units" value={settings.scale} onValueChange={(value) => setSettings((previous) => ({ ...previous, scale: value as Scale }))} options={SCALES} />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Orientation</legend>
          <RadioCards
            aria-label="Orientation"
            value={settings.orient ? "orient" : "keep"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, orient: value === "orient" }))}
            options={[
              { value: "orient", label: "Keep it upright", blurb: "Turn between Y-up (glTF, OBJ) and Z-up (STL, 3MF)" },
              { value: "keep", label: "Leave the axes alone", blurb: "The coordinates exactly as they were" },
            ]}
            columns={2}
          />
        </fieldset>
      </>
    ),
  };

  return (
    <PlainToolApp
      tool={tool}
      lead="Drop a 3D model - STL, OBJ, PLY, glTF (.glb) or 3MF - and get it back in another of them: 3MF or STL for a slicer, glTF for the web, OBJ for Blender. Units can be changed on the way, and the model is kept upright. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Converting"
      dropZone={{ accept: MODEL_ACCEPT, inputLabel: "Choose 3D models", headline: "Drop 3D models here", subhead: "STL, OBJ, PLY, GLB and 3MF" }}
      note="Only the shape converts: colours, textures, materials, UVs and animation are left behind, since STL has no place for them and the formats disagree about the rest. glTF's node transforms and 3MF's build transforms are applied, so parts land where the file put them, and vertices shared across triangles are welded so OBJ, PLY, glTF and 3MF files stay small. A .gltf that keeps its geometry in a separate .bin file cannot be read alone; export a .glb instead. Draco-compressed glTF is not read."
    />
  );
}
