// Test layers added to a copy of the sandbox composition (for the engine and UI tests of
// After Effects–style editing): a character with tagged parts and acting parameters (SvgRig),
// a flex row, a price, an SVG line, and set / keyframes tweens — on top of everything.
import { readFileSync, writeFileSync } from 'node:fs'

export function addTestLayers(compFile) {
  let html = readFileSync(compFile, 'utf8')
  const fixtures = `
        <div id="hero" data-ms-id="hero" data-ms-type="group" data-ms-label="주인공" style="position:absolute;left:1500px;top:560px;width:300px;height:300px">
          <svg viewBox="0 0 200 200" width="300" height="300"><g id="character">
            <g id="body" data-part="몸" data-label="몸" data-pivot="100 160"><rect x="70" y="110" width="60" height="80" fill="#3355ff"/>
              <g id="arm-l" data-part="팔" data-label="왼팔" data-pivot="72 120"><rect x="20" y="115" width="54" height="12" fill="#ff8800"/></g></g>
            <g id="head" data-part="머리" data-label="머리" data-pivot="100 100"><circle cx="100" cy="70" r="35" fill="#ffcc99"/></g>
          </g></svg>
        </div>
        <div data-ms-id="row" data-ms-type="group" data-ms-label="줄" style="position:absolute;left:100px;top:300px;display:flex;gap:20px">
          <div data-ms-id="row-a" data-ms-type="shape" data-ms-label="A" style="width:80px;height:40px;background:#888888"></div>
          <div data-ms-id="row-b" data-ms-type="shape" data-ms-label="B" style="width:120px;height:40px;background:#00ff00"></div>
        </div>
        <div data-ms-id="price" data-ms-type="text" data-ms-label="가격" style="position:absolute;left:100px;top:420px;font-size:60px;color:#ffffff">12,900원</div>
        <div data-ms-id="line" data-ms-type="shape" data-ms-label="선" style="position:absolute;left:100px;top:100px;width:400px;height:100px">
          <svg viewBox="0 0 400 100" width="400" height="100"><path d="M10 50 L390 50" stroke="#00ff00" stroke-width="30" fill="none"/></svg>
        </div>
        <div data-ms-id="t-set" data-ms-label="세트" style="position:absolute;left:100px;top:540px;width:50px;height:50px;background:#ffffff"></div>
        <div data-ms-id="t-kf" data-ms-label="단계" style="position:absolute;left:200px;top:540px;width:50px;height:50px;background:#00ffff"></div>`
  // on top of everything: at the end of the root (its closing tag is the last </div> before the script)
  const rootTag = html.match(/<[a-z]+\b[^>]*data-composition-id="[^"]*"[^>]*>/i)
  const endOfRoot = html.lastIndexOf('</div>', html.indexOf('<script>', rootTag.index))
  html = html.slice(0, endOfRoot) + fixtures + '\n    ' + html.slice(endOfRoot)
  html = html.replace('<script src="ms/runtime.js"></script>', '<script src="ms/runtime.js"></script>\n    <script src="ms/svgrig.js"></script>')
  html = html.replace('window.__timelines["main"] = tl;', `
        tl.set('[data-ms-id="t-set"]', { opacity: 0.4 }, 1);
        tl.fromTo('[data-ms-id="t-set"]', { x: 0 }, { x: 300, duration: 1, ease: 'none' }, 2);
        tl.to('[data-ms-id="t-kf"]', { keyframes: [{ x: 100, duration: 0.5 }, { y: 50, duration: 0.5 }] }, 0.2);
        var host = document.querySelector('[data-ms-id="hero"]');
        SvgRig.add(host, { 'look-x': 0, lid: 0 }, function (P) { host.querySelector('#head').setAttribute('transform', 'translate(' + P['look-x'] * 20 + ' 0)') });
        tl.to(host, { '--look-x': 1, duration: 1, ease: 'none' }, 0.5);
        window.__timelines["main"] = SvgRig.attach(tl);`)
  writeFileSync(compFile, html)

}

/**
 * More test layers (stages 2–3): a group with text and a picture Claude left without ids, a
 * styled line, texts for timed text and a custom animator, boxes for a curved path, a parent
 * link, a matte and motion blur, an element with a CSS animation, one masked by its own code.
 */
export function addMoreTestLayers(compFile) {
  let html = readFileSync(compFile, 'utf8')
  const more = `
        <div data-ms-id="card2" data-ms-type="group" data-ms-label="이름 없는 카드" style="position:absolute;left:600px;top:880px;width:400px;height:120px;background:#222222">
          <p style="margin:0;color:#ffffff;font-size:30px">이름 없는 문구</p>
          <img src="assets/yellow.png" style="width:40px;height:40px" alt="">
        </div>
        <div data-ms-id="styled" data-ms-type="text" data-ms-label="꾸민 줄" style="position:absolute;left:600px;top:700px;font-size:40px;color:#ffffff">할인 <b style="color:#ff0000">50%</b> 행사</div>
        <div data-ms-id="tt" data-ms-type="text" data-ms-label="바뀌는 문구" style="position:absolute;left:600px;top:760px;font-size:40px;color:#ffffff">하나</div>
        <div data-ms-id="tanim" data-ms-type="text" data-ms-label="글자 애니" style="position:absolute;left:600px;top:820px;font-size:40px;color:#ffffff">ABCDE</div>
        <div data-ms-id="curve" data-ms-label="곡선 상자" style="position:absolute;left:100px;top:700px;width:40px;height:40px;background:#ff00ff"></div>
        <div data-ms-id="child" data-ms-label="자식" style="position:absolute;left:800px;top:600px;width:40px;height:40px;background:#00ffff"></div>
        <div data-ms-id="mattebox" data-ms-label="매트 상자" style="position:absolute;left:1000px;top:100px;width:400px;height:200px;background:#ff0000"></div>
        <img data-ms-id="matteimg" data-ms-type="image" data-ms-label="매트 그림" src="assets/yellow.png" style="position:absolute;left:1050px;top:150px;width:100px;height:100px" alt="">
        <div data-ms-id="blurbox" data-ms-label="블러 상자" style="position:absolute;left:100px;top:800px;width:40px;height:40px;background:#ffffff"></div>
        <div data-ms-id="pulse" data-ms-label="깜빡이" class="ms-test-pulse" style="position:absolute;left:300px;top:800px;width:40px;height:40px;background:#ffff00"></div>
        <div data-ms-id="masked" data-ms-label="코드 마스크" style="position:absolute;left:400px;top:600px;width:100px;height:100px;background:#0000ff;-webkit-mask-image:linear-gradient(#000,#000);mask-image:linear-gradient(#000,#000)"></div>`
  const rootTag = html.match(/<[a-z]+\b[^>]*data-composition-id="[^"]*"[^>]*>/i)
  const endOfRoot = html.lastIndexOf('</div>', html.indexOf('<script>', rootTag.index))
  html = html.slice(0, endOfRoot) + more + '\n    ' + html.slice(endOfRoot)
  html = html.replace('</head>', '<style>@keyframes msTestPulse { from { opacity: 1 } to { opacity: 0.2 } } .ms-test-pulse { animation: msTestPulse 2s linear 1s both }</style>\n  </head>')
  html = html.replace('window.__timelines["main"] = SvgRig.attach(tl);', `tl.fromTo('[data-ms-id="masked"]', { x: 0 }, { x: 300, duration: 2, ease: 'none' }, 0);
        window.__timelines["main"] = SvgRig.attach(tl);`)
  writeFileSync(compFile, html)
}
