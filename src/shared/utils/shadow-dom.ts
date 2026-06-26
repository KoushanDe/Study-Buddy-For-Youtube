type QueryRoot = Document | Element | ShadowRoot

export function querySelectorAllDeep(root: QueryRoot, selector: string): Element[] {
  const results: Element[] = []

  try {
    results.push(...root.querySelectorAll(selector))
  } catch {
    return results
  }

  const elements = root.querySelectorAll('*')
  for (const element of elements) {
    if (element.shadowRoot) {
      results.push(...querySelectorAllDeep(element.shadowRoot, selector))
    }
  }

  return results
}
