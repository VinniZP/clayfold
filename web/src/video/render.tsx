import { Composition, continueRender, delayRender, registerRoot } from "remotion";
import "../styles/global.css";
import { LessonVideo, VIDEO, type LessonVideoProps } from "./LessonVideo";

// Entry of the bundle the server renders to MP4 (server/video-export.ts). The app plays the same composition in
// Remotion Player; here it gets its fonts itself, since the bundle has no app page around it.

const FONTS = "https://fonts.googleapis.com/css2?family=Onest:wght@400..700&family=Rubik:wght@600..900&display=block";

const fonts = delayRender("Loading fonts");
const link = document.createElement("link");
link.rel = "stylesheet";
link.href = FONTS;
link.onload = () => void document.fonts.ready.then(() => continueRender(fonts));
link.onerror = () => continueRender(fonts);
document.head.appendChild(link);

const EMPTY: LessonVideoProps = { title: "", timeline: { duration: 1, scenes: [], clips: [], chapters: [], captions: [] }, clipSrcs: [], captions: false };

function Root() {
  return (
    <Composition
      id="lesson"
      component={LessonVideo}
      width={VIDEO.width}
      height={VIDEO.height}
      fps={VIDEO.fps}
      durationInFrames={VIDEO.fps}
      defaultProps={EMPTY}
      calculateMetadata={({ props }) => ({ durationInFrames: Math.max(1, Math.ceil(props.timeline.duration * VIDEO.fps)) })}
    />
  );
}

registerRoot(Root);
