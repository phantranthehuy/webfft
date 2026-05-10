/**
 * @param {HTMLElement} parent
 * @param {...Node} nodes
 */
export function appendChildren(parent, ...nodes) {
  for (const n of nodes) parent.append(n);
}
