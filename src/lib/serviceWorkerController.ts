/** Initial service-worker claim is not an update to an existing controller. */
export function controllerChangeRequiresReload(initiallyControlled: boolean): () => boolean {
  let hadController = initiallyControlled;
  return () => {
    if (!hadController) { hadController = true; return false; }
    return true;
  };
}
