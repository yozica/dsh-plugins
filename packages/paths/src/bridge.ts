/**
 * HTML 预览的桥 —— 我们自己渲染 iframe，内容里的一切点击都经 `postMessage` 回到父组件。
 *
 * 为什么不改官方 html body：官方用 `sandbox="allow-scripts"` 且**没有** `allow-popups`，
 * 点击在 iframe 内就被丢掉（见 `docs/panel-path-links.md`）。我们接管后：
 *
 * - iframe 仍然**只收紧不放松**：`sandbox="allow-scripts"`，**不给** `allow-same-origin`；
 * - iframe 里的资源 URL **必须在沙箱内创建**（不透明源加载不了父页面创建的 blob URL），
 *   所以相对 `script[src]` / `link[rel=stylesheet]` 的文本随引导脚本一起传进去，
 *   由 iframe 自己 `URL.createObjectURL` 替换；
 * - 引导脚本先 `document.write` 原始 HTML，再装桥：拦 `<a>` 点击 + 把文本里的路径包成可点。
 *
 * @module @yozica/dsh-plugin-paths/bridge
 */
import { INLINE_PATH_PATTERN } from './paths.js';

/** 父组件用来辨认自己 iframe 的帧标记 */
export const BRIDGE_SOURCE = 'dsh-plugin-paths';

/** 一份随 HTML 一起搬进 iframe 的静态资源 */
export interface HtmlAsset {
  readonly kind: 'script' | 'stylesheet';
  /** 原始 HTML 里写的引用串（用它来定位要改哪个元素） */
  readonly reference: string;
  /** 资源文本（只支持 UTF-8 文本资源） */
  readonly text: string;
}

/**
 * 生成 iframe 的 `srcdoc`。
 *
 * payload 直接用 JSON 字面量嵌进 JS（`<` 转成 `\u003c`，避免内容里的 `</script>` 把引导脚本
 * 提前截断）；不用 base64 是因为这里两边都是我们自己拼的，没必要多一层编解码。
 */
export function frameDocument(html: string, assets: readonly HtmlAsset[]): string {
  const payload = JSON.stringify({ html, assets })
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  return `<!doctype html><meta charset="utf-8"><script>(()=>{
const bundle=${payload};
let html=bundle.html;
if(bundle.assets.length){
  try{
    const parsed=new DOMParser().parseFromString(html,'text/html');
    for(const asset of bundle.assets){
      const isScript=asset.kind==='script';
      const url=URL.createObjectURL(new Blob([asset.text],{type:isScript?'application/javascript':'text/css'}));
      const attribute=isScript?'src':'href';
      const selector=isScript?'script[src]':'link[rel~="stylesheet" i][href]';
      for(const element of parsed.querySelectorAll(selector)){
        if(element.getAttribute(attribute)===asset.reference)element.setAttribute(attribute,url);
      }
    }
    html='<!doctype html>'+parsed.documentElement.outerHTML;
  }catch(error){/* 资源替换失败就当没打包，正文照常显示 */}
}
document.open();document.write(html);document.close();
${bridgeBody()}
})()<\/script>`;
}

/** iframe 内部那段桥脚本（点击拦截 + 路径包裹） */
function bridgeBody(): string {
  const pattern = JSON.stringify(INLINE_PATH_PATTERN);
  return String.raw`
const MARKER=${JSON.stringify(BRIDGE_SOURCE)};
const send=(kind,target,line)=>{
  try{parent.postMessage({source:MARKER,kind:kind,target:target,line:line},'*');}catch(error){}
};
document.addEventListener('click',(event)=>{
  const start=event.target;
  if(!start||typeof start.closest!=='function')return;
  const pathElement=start.closest('[data-dsh-paths-reveal]');
  if(pathElement){
    event.preventDefault();event.stopPropagation();
    const line=Number(pathElement.getAttribute('data-dsh-paths-line'));
    send('path',pathElement.getAttribute('data-dsh-paths-reveal'),Number.isFinite(line)&&line>0?line:undefined);
    return;
  }
  const anchor=start.closest('a[href]');
  if(!anchor)return;
  const href=anchor.getAttribute('href')||'';
  if(href===''||href.charAt(0)==='#')return; // 页内锚点交给浏览器
  event.preventDefault();
  if(/^(?:https?|mailto|tel|ftp|ftps):/i.test(href))send('url',href);
  else send('path',href);
},true);
const PATTERN=new RegExp(${pattern},'g');
const style=document.createElement('style');
style.textContent='[data-dsh-paths-reveal]{cursor:pointer;text-decoration:underline dotted;text-underline-offset:2px}[data-dsh-paths-reveal]:hover{background:rgba(127,127,127,.18)}';
(document.head||document.documentElement).appendChild(style);
const acceptable=(node)=>{
  const parent=node.parentElement;
  if(!parent)return false;
  const tag=parent.tagName;
  if(tag==='SCRIPT'||tag==='STYLE'||tag==='TEXTAREA'||tag==='NOSCRIPT'||tag==='A')return false;
  if(parent.closest('[data-dsh-paths-reveal]'))return false;
  const value=node.nodeValue||'';
  return value.length>2&&value.indexOf('/')>=0;
};
const wrap=()=>{
  const root=document.body||document.documentElement;
  if(!root)return;
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null);
  const nodes=[];
  while(walker.nextNode()){
    const node=walker.currentNode;
    if(acceptable(node))nodes.push(node);
  }
  for(const node of nodes){
    const text=node.nodeValue||'';
    PATTERN.lastIndex=0;
    if(!PATTERN.test(text))continue;
    PATTERN.lastIndex=0;
    const fragment=document.createDocumentFragment();
    let last=0;
    let match;
    while((match=PATTERN.exec(text))!==null){
      if(match.index>last)fragment.appendChild(document.createTextNode(text.slice(last,match.index)));
      const span=document.createElement('span');
      span.setAttribute('data-dsh-paths-reveal',match[1]);
      if(match[2])span.setAttribute('data-dsh-paths-line',match[2]);
      span.textContent=match[0];
      fragment.appendChild(span);
      last=match.index+match[0].length;
    }
    if(last===0)continue;
    if(last<text.length)fragment.appendChild(document.createTextNode(text.slice(last)));
    if(node.parentNode)node.parentNode.replaceChild(fragment,node);
  }
};
wrap();
try{
  const observer=new MutationObserver(wrap);
  observer.observe(document.body||document.documentElement,{childList:true,subtree:true});
}catch(error){/* 没有 MutationObserver 就算了：首屏路径仍然可点 */}
`;
}
