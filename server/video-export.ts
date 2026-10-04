import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VideoExportView } from "../shared/api";
import type { LessonVideoProps } from "../web/src/video/LessonVideo";
import { config, paths } from "./config";

// Renders a lesson video to MP4 with Remotion's renderer: webpack bundles web/src/video/render.tsx once per process,
// headless Chrome draws every frame, and ffmpeg encodes the frames with the narration clips. Remotion downloads its
// Chrome Headless Shell on the first render.

const ENTRY = join(config.root, "web/src/video/render.tsx");

let bundled: Promise<string> | null = null;

function bundleOnce(): Promise<string> {
  bundled ??= (async () => {
    const [{ bundle }, { default: stylex }] = await Promise.all([import("@remotion/bundler"), import("@stylexjs/unplugin")]);
    return bundle({
      entryPoint: ENTRY,
      outDir: join(tmpdir(), "clayfold-video-bundle"),
      // The webpack cache does not see StyleX options change; one bundle per process takes seconds.
      enableCaching: false,
      webpackOverride: (c) => ({
        ...c,
        // Remotion's webpack config inlines CSS, so StyleX has no CSS asset to write into: styles are injected at runtime.
        plugins: [...(c.plugins ?? []), stylex.webpack({ useCSSLayers: true, runtimeInjection: true })],
        resolve: { ...c.resolve, alias: { ...(c.resolve?.alias as Record<string, string> | undefined), "@shared": join(config.root, "shared") } },
      }),
    });
  })().catch((e: unknown) => {
    bundled = null;
    throw e;
  });
  return bundled;
}

/** A file belongs to one version of a video: rebuilding the video makes a new version. */
const fileOf = (lessonId: string, version: string) => join(paths.exports, `${lessonId}-${version.replace(/\D/g, "")}.mp4`);

export class ExportBusyError extends Error {}

type Job = { lessonId: string; version: string; progress: number };

// One render at a time: it takes most of the CPU.
let job: Job | null = null;
const failures = new Map<string, string>();

export function exportView(lessonId: string, version: string | null): VideoExportView {
  if (!version) return { status: "none" };
  if (job?.lessonId === lessonId && job.version === version) return { status: "rendering", progress: job.progress };
  const file = fileOf(lessonId, version);
  if (existsSync(file)) {
    return { status: "ready", url: `/api/lessons/${encodeURIComponent(lessonId)}/video/export/file?v=${encodeURIComponent(version)}`, sizeBytes: statSync(file).size };
  }
  const error = failures.get(`${lessonId}:${version}`);
  return error ? { status: "failed", error } : { status: "none" };
}

export const exportFile = (lessonId: string, version: string): string | null => {
  const file = fileOf(lessonId, version);
  return existsSync(file) ? file : null;
};

/** Deletes the lesson's rendered files except `keep`, as when its video is made again. */
export function removeExports(lessonId: string, keep?: string): void {
  if (!existsSync(paths.exports)) return;
  for (const name of readdirSync(paths.exports)) {
    const file = join(paths.exports, name);
    if (name.startsWith(`${lessonId}-`) && file !== keep) rmSync(file, { force: true });
  }
}

/** Starts rendering in the background; throws ExportBusyError while another lesson renders. */
export function startExport(lessonId: string, version: string, props: LessonVideoProps): VideoExportView {
  if (job) {
    if (job.lessonId === lessonId && job.version === version) return exportView(lessonId, version);
    throw new ExportBusyError();
  }
  const current: Job = { lessonId, version, progress: 0 };
  job = current;
  failures.delete(`${lessonId}:${version}`);
  void render(current, props)
    .catch((e: unknown) => {
      console.error("[video export]", e);
      failures.set(`${lessonId}:${version}`, e instanceof Error ? e.message.split("\n")[0]!.slice(0, 300) : String(e));
    })
    .finally(() => {
      job = null;
    });
  return exportView(lessonId, version);
}

async function render(current: Job, inputProps: LessonVideoProps): Promise<void> {
  const { renderMedia, selectComposition } = await import("@remotion/renderer");
  const serveUrl = await bundleOnce();
  const composition = await selectComposition({ serveUrl, id: "lesson", inputProps });
  mkdirSync(paths.exports, { recursive: true });
  const file = fileOf(current.lessonId, current.version);
  const partial = file.replace(/\.mp4$/, ".part.mp4");
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: "h264",
    jpegQuality: 92,
    outputLocation: partial,
    onProgress: ({ progress }) => {
      current.progress = progress;
    },
  });
  renameSync(partial, file);
  removeExports(current.lessonId, file);
}
