/**
 * Investigation-only ADF quote guard. Do not alter the frozen B1 profiler:
 * source.path from its extracted ADF lines identifies the containing block.
 * A mixed block carrying a link may quote its *label* even if the target URL
 * itself was redacted. Suppress the complete mixed quote rather than guess
 * which text belongs to the unverified destination.
 */
export function linkedAdfBlocks(issue) {
  const root = issue?.fields?.description;
  const paths = new Set();
  if (!root || typeof root !== 'object') return paths;
  const blockTypes = new Set(['paragraph', 'heading', 'codeBlock']);
  function visit(node, path, parentBlock = null) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((child, index) => visit(child, path + '[' + index + ']', parentBlock));
      return;
    }
    const block = blockTypes.has(node.type) ? path : parentBlock;
    if (block && (
      (node.type === 'text' && (node.marks ?? []).some(mark =>
        mark?.type === 'link' || mark?.type === 'mention')) ||
      ['inlineCard', 'blockCard', 'embedCard'].includes(node.type) ||
      (typeof node.attrs?.url === 'string' && node.attrs.url.includes('/wiki/'))
    )) {
      paths.add(block);
    }
    visit(node.content, path + '.content', block);
  }
  visit(root, 'description');
  return paths;
}
