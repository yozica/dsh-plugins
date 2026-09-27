// 相对脚本：注入一段含路径的文本，验证桥的 MutationObserver 也会把它包成可点
const slot = document.getElementById('slot');
if (slot) {
  slot.textContent = '注入的路径：dsh-plugins/docs/panel-path-links.md';
}
