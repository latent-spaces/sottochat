import indexHtml from "../public/index.html" with { type: "file" };
import appJs from "../public/assets/app.js" with { type: "file" };
import frostingSvg from "../public/assets/frosting-new.svg" with { type: "file" };
import logoSvg from "../public/assets/logo.svg" with { type: "file" };
import mascot1Svg from "../public/assets/mascot-uni-1.svg" with { type: "file" };
import mascot2Svg from "../public/assets/mascot-uni-2.svg" with { type: "file" };
import mascot3Svg from "../public/assets/mascot-uni-3.svg" with { type: "file" };
import toAgentJs from "../public/assets/to-agent.js" with { type: "file" };
import gsapJs from "../public/assets/vendor/gsap.min.js" with { type: "file" };
import markedJs from "../public/assets/vendor/marked.min.js" with { type: "file" };

const STATIC_ASSETS = new Map<string, string>([
  // Bun's runtime file loader returns a path here. Its current .d.ts models
  // HTML imports as an HTMLBundle even when `type: "file"` is explicit.
  ["/", indexHtml as unknown as string],
  ["/index.html", indexHtml as unknown as string],
  ["/assets/app.js", appJs],
  ["/assets/frosting-new.svg", frostingSvg],
  ["/assets/logo.svg", logoSvg],
  ["/assets/mascot-uni-1.svg", mascot1Svg],
  ["/assets/mascot-uni-2.svg", mascot2Svg],
  ["/assets/mascot-uni-3.svg", mascot3Svg],
  ["/assets/to-agent.js", toAgentJs],
  ["/assets/vendor/gsap.min.js", gsapJs],
  ["/assets/vendor/marked.min.js", markedJs],
]);

export function staticAsset(pathname: string): Blob | null {
  const assetPath = STATIC_ASSETS.get(pathname);
  return assetPath ? Bun.file(assetPath) : null;
}
