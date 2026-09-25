"use client";

import { useMemo, useState } from "react";

import { FORMAT_LABELS, MODEL_ACCEPT, ModelError, readModel, write3mf, writeStl } from "@/lib/geometry/formats";
import { analyzeMesh, convertUp, repairMesh, type MeshReport } from "@/lib/geometry/mesh";
import { previewPng } from "@/lib/geometry/render";
import { formatBytes } from "@/lib/format-utils";
import { fileStem } from "@/lib/mediaTypes";
import { storageKey, useStoredSettings } from "@/lib/persist";
import { PlainError, type PlainOutputSpec, type PlainQueueOptions } from "@/lib/plainQueue";
import { requireTool } from "@/lib/tools";

import { PlainToolApp, type PlainSettings } from "../PlainToolApp";
import { RadioCards } from "../ui/RadioCards";
import styles from "../Settings.module.css";

const tool = requireTool("repair-3d-model");

const MAX_BYTES = 512 * 1024 * 1024;

/** PLA, the commonest filament, in grams per cubic centimetre. */
const PLA_DENSITY = 1.24;

interface RepairSettings {
  format: "stl" | "3mf";
  fillHoles: boolean;
}

function isSettings(value: unknown): value is RepairSettings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RepairSettings>;
  return (candidate.format === "stl" || candidate.format === "3mf") && typeof candidate.fillHoles === "boolean";
}

const round = (value: number) => (Math.abs(value) >= 100 ? value.toFixed(1) : Math.abs(value) >= 1 ? value.toFixed(2) : value.toPrecision(3));

function problems(report: MeshReport): string[] {
  const out: string[] = [];
  if (report.holes > 0) out.push(`${report.holes} ${report.holes === 1 ? "hole" : "holes"} (${report.boundaryEdges} open edges)`);
  if (report.flippedEdges > 0) out.push(`${report.flippedEdges} edges where a triangle faces the wrong way`);
  if (report.nonManifoldEdges > 0) out.push(`${report.nonManifoldEdges} non-manifold edges, shared by three or more triangles`);
  if (report.degenerate > 0) out.push(`${report.degenerate} degenerate triangles with no area`);
  if (report.duplicates > 0) out.push(`${report.duplicates} duplicate triangles`);
  if (report.watertight && report.volume < 0) out.push("every triangle faces inwards");
  return out;
}

/** A 3D model checked the way a slicer checks it, and repaired where it can be. */
export function Repair3dModelApp() {
  const [settings, setSettings] = useState<RepairSettings>({ format: "stl", fillHoles: true });
  useStoredSettings(storageKey("settings", "repair-3d-model"), settings, setSettings, isSettings);

  const queue = useMemo<PlainQueueOptions<RepairSettings>>(
    () => ({
      key: "repair-3d-model",
      settings,
      reject: (file) => (file.size === 0 ? { message: "This file is empty.", hint: "It is 0 bytes, which is not a model." } : file.size > MAX_BYTES ? { message: "This model is too large to check in a browser tab.", hint: `This reads models up to ${formatBytes(MAX_BYTES)}.` } : null),
      run: async (file, current, report) => {
        report("Reading...", null);
        let read;
        try {
          read = readModel(new Uint8Array(await file.arrayBuffer()), file.name);
        } catch (error) {
          if (error instanceof ModelError) throw new PlainError(error.message, error.hint, { cause: error });
          throw error;
        }
        report("Checking...", null);
        const mesh = convertUp(read.mesh, "z");
        const before = analyzeMesh(mesh);
        const millimetres = mesh.unit === null || mesh.unit === "millimeter";
        const unit = millimetres ? "mm" : mesh.unit === "meter" ? "m" : mesh.unit!;
        const found = problems(before);
        const facts = [
          `Read as: ${FORMAT_LABELS[read.format]}, ${before.triangles.toLocaleString("en")} triangles`,
          `Size: ${before.size.map(round).join(" x ")} ${unit}${mesh.unit === null ? " (STL has no units; slicers assume mm)" : ""}`,
          `Watertight: ${before.watertight && before.volume > 0 && found.length === 0 ? "yes" : "no"}`,
          `Shells: ${before.shells}${before.shells > 1 ? ", separate pieces" : ""}`,
        ];
        if (before.watertight) {
          const volume = Math.abs(before.volume);
          facts.push(millimetres ? `Volume: ${(volume / 1000).toFixed(2)} cm3, about ${Math.round((volume / 1000) * PLA_DENSITY)} g of PLA if printed solid` : `Volume: ${round(volume)} ${unit}3`);
        }
        facts.push(`Surface: ${millimetres ? `${(before.area / 100).toFixed(2)} cm2` : `${round(before.area)} ${unit}2`}`);
        report("Drawing a preview...", null);
        const outputs: PlainOutputSpec[] = [];
        const notes: string[] = [];
        if (found.length === 0) {
          const preview = await previewPng(mesh, 640);
          if (preview) outputs.push({ label: "Preview", fileName: `${fileStem(file.name, "model")}-preview.png`, blob: preview, kind: "image", note: "Seen from above and to one side" });
          notes.push("Nothing to repair: every edge is shared by exactly two triangles, all facing outwards.");
          return { facts, notes, outputs };
        }
        notes.push(`Found ${found.join(", ")}.`);
        report("Repairing...", null);
        const repaired = repairMesh(mesh, current.fillHoles);
        const after = analyzeMesh(repaired.mesh);
        const done: string[] = [];
        if (repaired.removedDegenerate > 0) done.push(`removed ${repaired.removedDegenerate} degenerate triangles`);
        if (repaired.removedDuplicates > 0) done.push(`removed ${repaired.removedDuplicates} duplicates`);
        if (repaired.flipped > 0) done.push(`turned ${repaired.flipped} triangles to face outwards`);
        if (repaired.holesFilled > 0) done.push(`filled ${repaired.holesFilled} ${repaired.holesFilled === 1 ? "hole" : "holes"}`);
        notes.push(`Repaired: ${done.join(", ") || "vertices welded"}. ${after.watertight ? "The result is watertight." : `Still not watertight: ${problems(after).join(", ") || "some edges remain open"}; those need a modelling program.`}`);
        if (after.nonManifoldEdges > 0) notes.push("Non-manifold edges are left alone: which triangles belong together there is a design decision, not a repair.");
        const data = current.format === "3mf" ? write3mf(repaired.mesh) : writeStl(repaired.mesh);
        outputs.push({ label: `Repaired ${current.format.toUpperCase()}`, fileName: `${fileStem(file.name, "model")}-repaired.${current.format}`, blob: new Blob([data as BlobPart], { type: current.format === "3mf" ? "model/3mf" : "model/stl" }), kind: "file", note: `${after.triangles.toLocaleString("en")} triangles${after.watertight ? ", watertight" : ""}` });
        const preview = await previewPng(repaired.mesh, 640);
        if (preview) outputs.push({ label: "Preview", fileName: `${fileStem(file.name, "model")}-preview.png`, blob: preview, kind: "image", note: "The repaired model" });
        return { facts, notes, outputs };
      },
    }),
    [settings],
  );

  const toolSettings: PlainSettings = {
    title: "Repair",
    summary: () => `save as ${settings.format.toUpperCase()}${settings.fillHoles ? ", holes filled" : ", holes left open"}`,
    render: () => (
      <>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Save repairs as</legend>
          <RadioCards
            aria-label="Save repairs as"
            value={settings.format}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, format: value as RepairSettings["format"] }))}
            options={[
              { value: "stl", label: "STL", blurb: "Every slicer reads it" },
              { value: "3mf", label: "3MF", blurb: "Smaller, and it carries its units" },
            ]}
            columns={2}
          />
        </fieldset>
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>Holes</legend>
          <RadioCards
            aria-label="Holes"
            value={settings.fillHoles ? "fill" : "leave"}
            onValueChange={(value) => setSettings((previous) => ({ ...previous, fillHoles: value === "fill" }))}
            options={[
              { value: "fill", label: "Fill them", blurb: "Patched flat from each hole's edge" },
              { value: "leave", label: "Leave them", blurb: "Only welding, removals and orientation" },
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
      lead="Drop a 3D model - STL, OBJ, PLY, glTF or 3MF - and see whether it will print: its size, volume and weight in PLA, whether it is watertight, and where it has holes, inside-out faces or broken edges. Most problems are repaired into a new STL or 3MF. Nothing is uploaded."
      queue={queue}
      settings={toolSettings}
      busyLabel="Checking"
      dropZone={{ accept: MODEL_ACCEPT, inputLabel: "Choose 3D models", headline: "Drop 3D models here", subhead: "Checked as they land" }}
      note="A printable model is watertight: every edge is shared by exactly two triangles that run along it in opposite directions, so the surface has a clear inside and outside. Repair welds vertices at the same place, removes triangles with no area and duplicates, turns every triangle to agree with its neighbours and each piece to face outwards, and fills each hole with a fan from its middle, which is exact for flat holes and a patch for curved ones. Non-manifold geometry and intersecting pieces are reported, not guessed at. The weight assumes solid PLA at 1.24 g/cm3; a slicer's infill makes it lighter."
    />
  );
}
