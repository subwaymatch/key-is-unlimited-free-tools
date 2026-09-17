import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Vendored verbatim from @ffmpeg/ffmpeg by scripts/copy-ffmpeg-worker.mjs.
      "public/ffmpeg/**",
      // Vendored verbatim from pdfjs-dist by scripts/copy-pdfjs-assets.mjs.
      "public/pdfjs/**",
    ],
  },
];

export default eslintConfig;
