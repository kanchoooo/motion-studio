import { fpsAttr, type OutputSpec } from '@shared/brief'

/** Starter composition every new project gets. Claude rewrites the body. */
export function starterComposition(out: OutputSpec): string {
  const bg = out.background === 'transparent' ? 'transparent' : out.backgroundColor
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${out.width}, height=${out.height}" />
    <!-- 모션스튜디오 필수 스크립트: 순서와 경로를 바꾸지 마세요 -->
    <script src="vendor/gsap.min.js"></script>
    <link rel="stylesheet" href="ms/fonts.css" />
    <script src="ms/overrides.js"></script>
    <script src="ms/runtime.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${out.width}px; height: ${out.height}px; overflow: hidden; background: ${bg}; }
      #root { position: relative; width: ${out.width}px; height: ${out.height}px; overflow: hidden; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${out.duration}" data-width="${out.width}" data-height="${out.height}" data-fps="${fpsAttr(out.fps)}" data-ms-empty="true"></div>
    <script>
      const tl = gsap.timeline({ paused: true });
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`
}

export const HYPERFRAMES_JSON = {
  $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
  paths: { blocks: 'compositions', components: 'compositions/components', assets: 'assets' },
  media: { autoProxy: true },
}

/** a composition counts as a video once Claude replaced the empty starter */
export function compositionHasVideo(html: string): boolean {
  return !html.includes('data-ms-empty="true"') && /data-ms-id=|class="[^"]*\bclip\b/.test(html)
}
